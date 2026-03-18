const fs = require('fs');

const path = 'src/styles/dashboard.css';

const css = `
.dashboard-container {
  padding: 24px 32px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
  margin-bottom: 32px;
}

.stat-card {
  background-color: var(--bg-card, #ffffff);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);
  transition: box-shadow 0.2s;
}
.stat-card:hover {
  box-shadow: 0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: var(--brand-primary, #ff6b00);
  background-color: var(--brand-dim, rgba(255,107,0,0.08));
}

.stat-info {
  display: flex;
  flex-direction: column;
}
.stat-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.stat-label {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

/* Quick Actions Grid */
.actions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  margin-top: 16px;
}

.action-card {
  background-color: var(--bg-card);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid transparent;
}

.action-card:hover {
  box-shadow: 0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15);
  transform: translateY(-2px);
}

.action-header {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--text-primary);
}

.card-icon {
  font-size: 28px;
  color: var(--brand-primary);
}

.action-desc {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* Activity Feed (if any) */
.dashboard-section-title {
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--text-primary);
  margin: 32px 0 16px;
}
`;

fs.writeFileSync(path, css.trim());
console.log('Dashboard CSS updated!');
