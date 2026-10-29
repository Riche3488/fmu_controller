import { Group } from '@mantine/core';
import { NavLink, useLocation } from 'react-router-dom';
import { STEPS, stepDone, type StepKey, type WorkflowInput } from '../../lib/workflow';

export function currentStep(pathname: string, fmuId: string): StepKey {
  const rest = pathname.split(`/fmus/${fmuId}`)[1]?.replace(/^\//, '') ?? '';
  const seg = rest.split('/')[0];
  return STEPS.find(s => s.path === seg)?.key ?? 'model';
}

export function StepBar({ fmuId, input }: { fmuId: string; input?: WorkflowInput }) {
  const { pathname } = useLocation();
  const current = currentStep(pathname, fmuId);
  return (
    <nav aria-label="진행 단계">
      <Group gap="xs">
        {STEPS.map(s => {
          const active = s.key === current;
          return (
            <NavLink
              key={s.key}
              to={s.path ? `/fmus/${fmuId}/${s.path}` : `/fmus/${fmuId}`}
              end={!s.path}
              aria-current={active ? 'step' : undefined}
              style={{
                padding: '6px 12px', borderRadius: 6, textDecoration: 'none', fontSize: 14,
                fontWeight: active ? 700 : 400, color: 'inherit',
                border: '1px solid var(--mantine-color-default-border)',
                background: active ? 'var(--mantine-primary-color-light)' : undefined,
              }}
            >
              {s.label}
              {input && stepDone(s.key, input) && <span aria-label="완료" style={{ marginLeft: 6 }}>✓</span>}
            </NavLink>
          );
        })}
      </Group>
    </nav>
  );
}
