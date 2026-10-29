// 배치/최적화 설정 화면 상단 메뉴 바: 프리셋 저장·불러오기·지난 잡 설정 가져오기
import { Badge, Button, Group, Kbd, Menu, Modal, Paper, Stack, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/client';
import type { Job, Preset, PresetKind } from '../api/types';
import { jobSummary, presetSummary } from '../lib/presets';

const MAX_RECENT_JOBS = 8;
const NO_TRANSITION = { transitionProps: { duration: 0 } };

export function usePresets(kind?: PresetKind) {
  const api = useApi();
  return useQuery({ queryKey: ['presets', kind ?? 'all'], queryFn: () => api.listPresets(kind ? { kind } : {}) });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 이름 하나를 받는 모달. onSubmit이 던진 오류(이름 중복 등)는 입력칸 아래에 보여 준다. */
export function PresetNameModal({ opened, title, initialName, confirmLabel, onClose, onSubmit, children }: {
  opened: boolean;
  title: string;
  initialName: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lastOpened, setLastOpened] = useState(false);
  if (opened !== lastOpened) {
    // 열릴 때마다 초기 이름으로 되돌린다
    setLastOpened(opened);
    if (opened) {
      setName(initialName);
      setError(null);
    }
  }
  const submit = async () => {
    if (!name.trim()) {
      setError('이름을 입력하세요');
      return;
    }
    setPending(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title={title} transitionProps={{ duration: 0 }}>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <Stack>
          <TextInput label="프리셋 이름" data-autofocus value={name} error={error}
            onChange={e => { setName(e.currentTarget.value); setError(null); }} />
          {children}
          <Group justify="end">
            <Button variant="default" onClick={onClose}>취소</Button>
            <Button type="submit" loading={pending}>{confirmLabel}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function PresetItem({ preset, onClick, other }: { preset: Preset; onClick: () => void; other?: boolean }) {
  return (
    <Menu.Item onClick={onClick}>
      <Text size="sm">{preset.name}</Text>
      <Text size="xs" c="dimmed">
        {presetSummary(preset)} · {fmtTime(preset.updatedAt)}
        {other && preset.sourceModelName ? ` · ${preset.sourceModelName}` : ''}
      </Text>
    </Menu.Item>
  );
}

export function PresetMenuBar({ kind, fmuId, current, dirty, onNew, onSave, onSaveAs, onRename, onDelete, onLoadPreset, onLoadJob }: {
  kind: PresetKind;
  fmuId: string;
  current: Preset | null;
  dirty: boolean;
  onNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onRename: () => void;
  onDelete: () => void;
  onLoadPreset: (p: Preset) => void;
  onLoadJob: (j: Job) => void;
}) {
  const api = useApi();
  const presets = usePresets(kind);
  const jobs = useQuery({ queryKey: ['jobs', fmuId], queryFn: () => api.listJobs({ fmuId }) });
  const list = presets.data ?? [];
  const mine = list.filter(p => p.sourceFmuId === fmuId);
  const others = list.filter(p => p.sourceFmuId !== fmuId);
  const recent = (jobs.data ?? []).filter(j => j.kind === kind).slice(0, MAX_RECENT_JOBS);

  return (
    <Paper withBorder px="xs" py={4} pos="sticky" top="calc(var(--app-shell-header-height) + 4px)" style={{ zIndex: 5 }} data-testid="preset-menubar">
      <Group justify="space-between" wrap="nowrap">
        <Group gap={2}>
          <Menu position="bottom-start" shadow="md" width={260} {...NO_TRANSITION}>
            <Menu.Target><Button variant="subtle" size="compact-sm">프리셋</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={onNew}>새 설정</Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={onSave} rightSection={<Kbd size="xs">Ctrl+S</Kbd>}>
                {current ? `저장 (${current.name} 덮어쓰기)` : '저장…'}
              </Menu.Item>
              <Menu.Item onClick={onSaveAs}>다른 이름으로 저장…</Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={onRename} disabled={!current}>이름 바꾸기…</Menu.Item>
              <Menu.Item onClick={onDelete} disabled={!current} color="red">현재 프리셋 삭제…</Menu.Item>
              <Menu.Divider />
              <Menu.Item component={Link} to={`/presets?kind=${kind}`}>프리셋 관리</Menu.Item>
            </Menu.Dropdown>
          </Menu>

          <Menu position="bottom-start" shadow="md" width={380} {...NO_TRANSITION}>
            <Menu.Target><Button variant="subtle" size="compact-sm">불러오기</Button></Menu.Target>
            <Menu.Dropdown mah={480} style={{ overflowY: 'auto' }}>
              <Menu.Label>이 FMU에서 저장한 프리셋</Menu.Label>
              {mine.length === 0 && <Text size="xs" c="dimmed" px="sm" pb={4}>없음</Text>}
              {mine.map(p => <PresetItem key={p.id} preset={p} onClick={() => onLoadPreset(p)} />)}
              {others.length > 0 && (
                <>
                  <Menu.Divider />
                  <Menu.Label>다른 FMU의 프리셋 (없는 변수·후보는 빠집니다)</Menu.Label>
                  {others.map(p => <PresetItem key={p.id} preset={p} other onClick={() => onLoadPreset(p)} />)}
                </>
              )}
              <Menu.Divider />
              <Menu.Label>최근 {kind === 'batch' ? '배치' : '최적화'} 잡의 설정</Menu.Label>
              {recent.length === 0 && <Text size="xs" c="dimmed" px="sm" pb={4}>없음</Text>}
              {recent.map(j => (
                <Menu.Item key={j.id} onClick={() => onLoadJob(j)}>
                  <Text size="sm">{j.name}</Text>
                  <Text size="xs" c="dimmed">{jobSummary(j)} · {fmtTime(j.createdAt)}</Text>
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>

        <Group gap="xs" wrap="nowrap">
          {current
            ? <Badge variant="light" tt="none" data-testid="current-preset">{current.name}</Badge>
            : <Text size="xs" c="dimmed">프리셋 없음</Text>}
          {current && dirty && <Text size="xs" c="orange" data-testid="preset-dirty">● 수정됨</Text>}
        </Group>
      </Group>
    </Paper>
  );
}
