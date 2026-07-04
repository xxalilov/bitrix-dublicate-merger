import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const ENTITY_LABEL = { contact: 'Контакт', lead: 'Лид', company: 'Компания', deal: 'Сделка' };
const PAGE_SIZE = 50;

function fmt(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

export default function HistoryTab() {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/history?page=${page}&limit=${PAGE_SIZE}`)
      .then((r) => { if (!cancelled) { setRows(r.data || []); setTotal(r.total || 0); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loading) return <div className="muted">Загрузка истории…</div>;
  if (total === 0) return <div className="muted">Операций пока нет.</div>;

  return (
    <div>
      <table className="table">
        <thead>
          <tr><th>Дата</th><th>Тип</th><th>Основная</th><th>Удалено</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmt(r.createdAt)}</td>
              <td>{ENTITY_LABEL[r.entity] || r.entity}</td>
              <td>{r.mainName || `#${r.mainId}`} <span className="muted">(ID: {r.mainId})</span></td>
              <td>{(r.deletedIds || []).map((id) => `#${id}`).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} type="button">← Назад</button>
          <span className="muted">Страница {page} из {totalPages} · всего {total}</span>
          <button className="btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} type="button">Вперёд →</button>
        </div>
      )}
    </div>
  );
}
