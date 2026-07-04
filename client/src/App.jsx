import React, { useEffect, useState } from 'react';
import { resolveMember } from './bx24.js';
import { setMember } from './api.js';
import FindTab from './tabs/FindTab.jsx';
import SettingsTab from './tabs/SettingsTab.jsx';
import HistoryTab from './tabs/HistoryTab.jsx';
import StatsTab from './tabs/StatsTab.jsx';

const TABS = [
  { id: 'find', label: 'Поиск дублей' },
  { id: 'settings', label: 'Настройки' },
  { id: 'history', label: 'История' },
  { id: 'stats', label: 'Статистика' },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [tab, setTab] = useState('find');

  useEffect(() => {
    resolveMember().then(({ memberId }) => {
      setMember(memberId);
      setMemberId(memberId);
      setReady(true);
    });
  }, []);

  if (!ready) return <div className="center muted">Загрузка…</div>;
  if (!memberId) {
    return (
      <div className="center muted">
        Откройте приложение внутри Bitrix24 — портал не определён.
      </div>
    );
  }

  return (
    <div className="app">
      <h1 className="app__title">Поиск и объединение дубликатов</h1>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tabs__item ${tab === t.id ? 'tabs__item--active' : ''}`}
            onClick={() => setTab(t.id)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {tab === 'find' && <FindTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'stats' && <StatsTab />}
      </main>
    </div>
  );
}
