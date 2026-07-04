import React, { useMemo, useRef, useState } from 'react';
import { api, pollJob } from '../api.js';

const ENTITIES = [
  { id: 'contact', label: 'Контакты' },
  { id: 'lead', label: 'Лиды' },
  { id: 'company', label: 'Компании' },
];
const FIELDS = [
  { id: 'phone', label: 'Телефон' },
  { id: 'email', label: 'Email' },
  { id: 'name', label: 'Имя / Название' },
];

export default function FindTab() {
  const [entity, setEntity] = useState('contact');
  const [field, setField] = useState('phone');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [groups, setGroups] = useState([]);
  const [mains, setMains] = useState({}); // group key -> chosen main id
  const scanRef = useRef(0);

  const findAll = async () => {
    const runId = ++scanRef.current;
    setLoading(true);
    setGroups([]);
    setStatus({ kind: 'info', text: 'Запуск сканирования…' });
    try {
      const { jobId } = await api.post('/api/scan', { entity, field });
      const job = await pollJob(
        jobId,
        (j) => scanRef.current === runId && setStatus({ kind: 'info', text: `Сканирование… проверено ${j.scanned}, групп: ${j.groupsFound}` }),
        () => scanRef.current !== runId,
      );
      if (!job || scanRef.current !== runId) return;
      const gs = job.groups || [];
      setGroups(gs);
      setMains(Object.fromEntries(gs.map((g) => [g.key, g.items[0]?.id])));
      setStatus(gs.length ? null : { kind: 'info', text: 'Дубликаты не найдены' });
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
    } finally {
      if (scanRef.current === runId) setLoading(false);
    }
  };

  const searchOne = async () => {
    const value = query.trim();
    if (!value) return;
    ++scanRef.current;
    setLoading(true);
    setGroups([]);
    setStatus({ kind: 'info', text: 'Поиск…' });
    try {
      const { group } = await api.post('/api/search', { entity, field, value });
      if (group && group.items.length) {
        setGroups([group]);
        setMains({ [group.key]: group.items[0]?.id });
        setStatus(group.items.length > 1 ? null : { kind: 'info', text: 'Найдена 1 запись (дублей нет)' });
      } else {
        setStatus({ kind: 'info', text: 'Ничего не найдено' });
      }
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const mergeGroup = async (g) => {
    const mainId = mains[g.key];
    const others = g.items.filter((i) => i.id !== mainId).map((i) => i.id);
    if (!mainId || !others.length) return;
    const mainName = g.items.find((i) => i.id === mainId)?.name || '';
    setLoading(true);
    try {
      await api.post('/api/merge', { entity, ids: [mainId, ...others], mainName });
      setStatus({ kind: 'info', text: 'Объединено' });
      await findAll();
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
      setLoading(false);
    }
  };

  const mergeAll = async () => {
    const payload = groups
      .map((g) => {
        const mainId = mains[g.key] ?? g.items[0]?.id;
        const ids = [mainId, ...g.items.filter((i) => i.id !== mainId).map((i) => i.id)];
        return { ids, mainName: g.items.find((i) => i.id === mainId)?.name || '' };
      })
      .filter((p) => p.ids.length >= 2);
    if (!payload.length) return;
    setLoading(true);
    setStatus({ kind: 'info', text: `Объединение 0/${payload.length}…` });
    try {
      const { jobId } = await api.post('/api/merge-all', { entity, groups: payload });
      await pollJob(jobId, (j) =>
        setStatus({ kind: 'info', text: `Объединение… ${j.processed || 0}/${j.total || payload.length}${j.failed ? `, ошибок: ${j.failed}` : ''}` }),
      );
      await findAll();
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
      setLoading(false);
    }
  };

  const fieldLabel = useMemo(
    () => (entity === 'lead' ? 'Группа' : FIELDS.find((f) => f.id === field)?.label || 'Поле'),
    [field, entity],
  );

  return (
    <div>
      <div className="toolbar">
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className="input">
          {ENTITIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        {entity !== 'lead' && (
          <select value={field} onChange={(e) => setField(e.target.value)} className="input">
            {FIELDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        )}
        {entity === 'lead' && <span className="muted">группировка по настройкам</span>}
        <button className="btn btn--primary" onClick={findAll} disabled={loading} type="button">
          Найти все дубли
        </button>
        <input
          className="input"
          type="text"
          value={query}
          placeholder="Поиск по значению…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && searchOne()}
        />
        <button className="btn" onClick={searchOne} disabled={loading || !query.trim()} type="button">
          Найти по значению
        </button>
        {groups.length > 0 && (
          <button className="btn btn--danger" onClick={mergeAll} disabled={loading} type="button">
            Объединить все
          </button>
        )}
      </div>

      {status && <div className={`status status--${status.kind}`}>{status.text}</div>}
      {loading && <div className="muted">Загрузка…</div>}

      {groups.map((g) => (
        <div key={g.key} className="group">
          <div className="group__head">
            <span className="muted">{fieldLabel}: {g.value}</span>
            <button className="btn btn--primary" onClick={() => mergeGroup(g)} disabled={loading} type="button">
              Объединить
            </button>
          </div>
          <div className="cells">
            {g.items.map((item) => {
              const isMain = mains[g.key] === item.id;
              return (
                <div
                  key={item.id}
                  className={`cell ${isMain ? 'cell--main' : ''}`}
                  onClick={() => setMains((m) => ({ ...m, [g.key]: item.id }))}
                  title={isMain ? 'Основная (останется)' : 'Сделать основной'}
                >
                  <div className="cell__name">{item.name}</div>
                  <div className="cell__id">{ENTITIES.find((e) => e.id === entity)?.label.slice(0, -1)} · ID: {item.id}</div>
                  <div className="cell__match">{fieldLabel}: {item.match}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {groups.length > 0 && (
        <div className="muted hint">Нажмите на карточку, чтобы сделать запись основной (зелёная рамка). Остальные будут объединены в неё и удалены.</div>
      )}
    </div>
  );
}
