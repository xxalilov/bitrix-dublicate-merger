import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const ENTITIES = [
  { key: 'contact', label: 'Контакты' },
  { key: 'company', label: 'Компании' },
  { key: 'lead', label: 'Лиды' },
];

const DEFAULTS = {
  contact: { entity: 'contact', matchField: 'phone', normalizePhone: true, phoneLastNDigits: 0, survivor: 'oldest', tagMode: false, tagName: '', autoMergeOnCreate: false, groupBy: 'byContact', categoryFilter: '', stageFilter: '' },
  company: { entity: 'company', matchField: 'name', normalizePhone: true, phoneLastNDigits: 0, survivor: 'oldest', tagMode: false, tagName: '', autoMergeOnCreate: false, groupBy: 'byContact', categoryFilter: '', stageFilter: '' },
  lead: { entity: 'lead', matchField: 'phone', normalizePhone: true, phoneLastNDigits: 0, survivor: 'oldest', tagMode: false, tagName: '', autoMergeOnCreate: false, groupBy: 'byContact', categoryFilter: '', stageFilter: '' },
};

export default function SettingsTab() {
  const [all, setAll] = useState(DEFAULTS);
  const [entity, setEntity] = useState('contact');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get('/api/settings')
      .then((r) => setAll((prev) => ({
        contact: { ...DEFAULTS.contact, ...(r.data?.contact || {}) },
        company: { ...DEFAULTS.company, ...(r.data?.company || {}) },
        lead: { ...DEFAULTS.lead, ...(r.data?.lead || {}) },
      })))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const s = all[entity];
  const set = (patch) => { setAll((p) => ({ ...p, [entity]: { ...p[entity], ...patch } })); setMsg(null); };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await api.put('/api/settings', s);
      setAll((p) => ({ ...p, [entity]: { ...DEFAULTS[entity], ...r.data } }));
      setMsg({ kind: 'info', text: 'Настройки сохранены' });
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="muted">Загрузка настроек…</div>;

  const isPhone = s.matchField === 'phone';

  return (
    <div className="settings">
      <div className="subtabs">
        {ENTITIES.map((e) => (
          <button
            key={e.key}
            type="button"
            className={`subtab ${entity === e.key ? 'subtab--active' : ''}`}
            onClick={() => { setEntity(e.key); setMsg(null); }}
          >
            {e.label}
          </button>
        ))}
      </div>

      <div className="row">
        <span>Поле для поиска дублей</span>
        <select className="input" value={s.matchField} onChange={(e) => set({ matchField: e.target.value })}>
          <option value="phone">Телефон</option>
          <option value="email">Email</option>
          <option value="name">Имя / Название</option>
        </select>
      </div>

      {isPhone && (
        <>
          <div className="row">
            <span>Нормализовать телефон (сравнивать только цифры)</span>
            <input type="checkbox" checked={s.normalizePhone} onChange={(e) => set({ normalizePhone: e.target.checked })} />
          </div>
          <div className="row">
            <span>Сравнивать только последние N цифр (0 = целиком)</span>
            <input className="input input--num" type="number" min="0" max="15" value={s.phoneLastNDigits}
              onChange={(e) => set({ phoneLastNDigits: Number(e.target.value) || 0 })} />
          </div>
        </>
      )}

      {entity === 'lead' && (
        <>
          <div className="row">
            <span>Группировать сделки по</span>
            <select className="input" value={s.groupBy} onChange={(e) => set({ groupBy: e.target.value })}>
              <option value="byContact">Контакту</option>
              <option value="byCompany">Компании</option>
              <option value="byName">Названию</option>
            </select>
          </div>
          <div className="row">
            <span>Только воронки (ID через запятую, пусто = все)</span>
            <input className="input" type="text" value={s.categoryFilter} placeholder="0,1,2"
              onChange={(e) => set({ categoryFilter: e.target.value })} />
          </div>
          <div className="row">
            <span>Только стадии (ID через запятую, пусто = все)</span>
            <input className="input" type="text" value={s.stageFilter} placeholder="NEW,IN_PROCESS"
              onChange={(e) => set({ stageFilter: e.target.value })} />
          </div>
        </>
      )}

      <div className="row">
        <span>Какая запись остаётся главной</span>
        <select className="input" value={s.survivor} onChange={(e) => set({ survivor: e.target.value })}>
          <option value="oldest">Самая старая</option>
          <option value="newest">Самая новая</option>
        </select>
      </div>

      <div className="row">
        <span>Помечать тегом вместо объединения</span>
        <input type="checkbox" checked={s.tagMode} onChange={(e) => set({ tagMode: e.target.checked })} />
      </div>
      {s.tagMode && (
        <div className="row">
          <span>Название тега</span>
          <input className="input" type="text" value={s.tagName} placeholder="duplicate"
            onChange={(e) => set({ tagName: e.target.value })} />
        </div>
      )}

      <div className="row">
        <span>Объединять новые дубли автоматически (при создании)</span>
        <input type="checkbox" checked={s.autoMergeOnCreate} onChange={(e) => set({ autoMergeOnCreate: e.target.checked })} />
      </div>

      {msg && <div className={`status status--${msg.kind}`}>{msg.text}</div>}
      <button className="btn btn--primary" onClick={save} disabled={saving} type="button">
        {saving ? 'Сохранение…' : 'Сохранить'}
      </button>
    </div>
  );
}
