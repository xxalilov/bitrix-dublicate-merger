import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const ENTITIES = [
  { id: 'contact', label: 'Контакты' },
  { id: 'lead', label: 'Лиды' },
  { id: 'company', label: 'Компании' },
];

function fmt(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function Card({ title, d }) {
  return (
    <div className="stat-card">
      <div className="stat-card__title">{title}</div>
      <div className="stat-row"><span className="muted">Просмотрено (последний скан)</span><b>{d.scanned}</b></div>
      <div className="stat-row"><span className="muted">Найдено групп дублей</span><b>{d.groupsFound}</b></div>
      <div className="stat-row"><span className="muted">Объединено записей</span><b>{d.mergedRecords}</b></div>
      <div className="stat-row"><span className="muted">Операций объединения</span><b>{d.mergedOperations}</b></div>
      <div className="stat-row"><span className="muted">Последний скан</span><span className="muted">{fmt(d.scannedAt)}</span></div>
    </div>
  );
}

export default function StatsTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/stats')
      .then((r) => setStats(r.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="muted">Загрузка статистики…</div>;
  if (error) return <div className="status status--error">{error}</div>;
  if (!stats) return null;

  return (
    <div>
      <div className="stats-grid">
        {ENTITIES.map((e) => <Card key={e.id} title={e.label} d={stats[e.id]} />)}
      </div>
      <div className="muted" style={{ marginTop: 14 }}>Последнее объединение: {fmt(stats.lastMergeAt)}</div>
    </div>
  );
}
