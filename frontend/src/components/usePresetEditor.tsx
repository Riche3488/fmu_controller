// 설정 화면(배치·최적화) 공통 프리셋 동작: 저장·덮어쓰기·불러오기·되돌리기·"수정됨" 표시·URL 진입
import { Alert, Button, Group, List, Modal, Text } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api/client';
import type { Job, Preset, PresetConfigs, PresetInput, PresetKind, PresetOf } from '../api/types';
import { PresetMenuBar, PresetNameModal, usePresets } from './PresetMenuBar';

const KIND_LABEL: Record<PresetKind, string> = { optimization: '최적화', batch: '배치', dashboard: '대시보드' };
const SAVE_NOTE: Record<PresetKind, string> = {
  optimization: '목적함수·알고리즘·설계 변수·Resource 선택·실행 설정·표시 변수를 저장합니다. 잡 이름은 저장하지 않습니다.',
  batch: '스윕 파라미터·샘플링·Resource 후보·실행 설정·표시 변수를 저장합니다. 잡 이름은 저장하지 않습니다.',
  dashboard: '차트 레이아웃과 패널 설정을 저장합니다.',
};

export const nowStamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

type Notice<K extends PresetKind, F> = {
  message: string;
  warnings: string[];
  undo: { form: F; current: PresetOf<K> | null; savedJson: string | null; name: string };
};

export function usePresetEditor<K extends PresetKind, F>(opts: {
  kind: K;
  fmuId: string;
  modelName: string;
  /** null = 아직 폼이 준비되지 않음 */
  form: F | null;
  /** 불러오기에 필요한 데이터(변수·resource 목록 등)가 모두 준비됨 */
  ready: boolean;
  toConfig: (f: F) => PresetConfigs[K];
  fromConfig: (cfg: PresetConfigs[K]) => { form: F; warnings: string[] };
  /** 없으면 잡 설정 불러오기를 감춘다 */
  jobToConfig?: (job: Job) => PresetConfigs[K];
  defaultForm: () => F;
  setForm: (f: F) => void;
  name: string;
  setName: (name: string) => void;
  menuLabel?: string;
  sticky?: boolean;
}): { menuBar: ReactNode; notice: ReactNode; modals: ReactNode } {
  const { kind, fmuId, form, ready, toConfig } = opts;
  const api = useApi();
  const qc = useQueryClient();
  const presets = usePresets(kind);
  const [searchParams] = useSearchParams();
  // 저장된 내용과 지금 폼을 JSON으로 비교해 "수정됨"을 표시한다
  const [current, setCurrent] = useState<PresetOf<K> | null>(null);
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice<K, F> | null>(null);
  const [modal, setModal] = useState<'saveAs' | 'rename' | 'delete' | null>(null);

  const dirty = !!current && !!form && JSON.stringify(toConfig(form)) !== savedJson;

  const remember = (message: string, warnings: string[] = []) => {
    if (form) setNotice({ message, warnings, undo: { form, current, savedJson, name: opts.name } });
  };

  const loadConfig = (cfg: PresetConfigs[K], message: string, preset: PresetOf<K> | null) => {
    if (!ready) return;
    const { form: next, warnings } = opts.fromConfig(cfg);
    remember(message, warnings);
    opts.setForm(next);
    setCurrent(preset);
    setSavedJson(preset ? JSON.stringify(toConfig(next)) : null);
    if (preset) opts.setName(`${preset.name} ${nowStamp()}`);
  };
  const loadPreset = (p: PresetOf<K>) => loadConfig(p.config, `프리셋 '${p.name}'을(를) 불러왔습니다`, p);
  const jobToConfig = opts.jobToConfig;
  const loadJob = jobToConfig
    ? (j: Job) => loadConfig(jobToConfig(j), `잡 '${j.name}'의 설정을 불러왔습니다`, null)
    : undefined;

  const newForm = () => {
    if (!form) return;
    remember('새 설정으로 초기화했습니다');
    opts.setForm(opts.defaultForm());
    setCurrent(null);
    setSavedJson(null);
  };

  const undo = () => {
    if (!notice) return;
    opts.setForm(notice.undo.form);
    setCurrent(notice.undo.current);
    setSavedJson(notice.undo.savedJson);
    opts.setName(notice.undo.name);
    setNotice(null);
  };

  // ?preset=<id> 또는 ?fromJob=<id>로 들어오면 한 번 불러온다 (프리셋 관리·잡 모니터에서 연결)
  const presetParam = searchParams.get('preset');
  const jobParam = searchParams.get('fromJob');
  const fromJob = useQuery({ queryKey: ['job', jobParam], queryFn: () => api.getJob(jobParam!), enabled: !!jobParam && !!loadJob });
  const initialLoaded = useRef(false);
  useEffect(() => {
    if (initialLoaded.current || !ready) return;
    if (presetParam) {
      if (!presets.isFetched) return;
      const p = presets.data?.find(x => x.id === presetParam);
      if (p) loadPreset(p as PresetOf<K>);
    } else if (jobParam && loadJob) {
      if (!fromJob.isFetched) return;
      if (fromJob.data?.kind === kind) loadJob(fromJob.data);
    }
    initialLoaded.current = true;
  });

  const afterSave = (p: PresetOf<K>, cfg: PresetConfigs[K]) => {
    setCurrent(p);
    setSavedJson(JSON.stringify(cfg));
    qc.invalidateQueries({ queryKey: ['presets'] });
  };
  const input = (name: string, config: PresetConfigs[K], sourceFmuId: string | null = fmuId) =>
    ({ name, kind, sourceFmuId, config }) as PresetInput;

  const overwrite = useMutation({
    mutationFn: ({ p, cfg }: { p: PresetOf<K>; cfg: PresetConfigs[K] }) => api.updatePreset(p.id, input(p.name, cfg)),
    onSuccess: (p, { cfg }) => {
      afterSave(p as PresetOf<K>, cfg);
      notifications.show({ message: `프리셋 '${p.name}'에 저장했습니다`, color: 'green' });
    },
    onError: e => notifications.show({ message: (e as Error).message, color: 'red' }),
  });
  const save = () => {
    if (!form) return;
    if (current) overwrite.mutate({ p: current, cfg: toConfig(form) });
    else setModal('saveAs');
  };
  const saveAs = async (name: string) => {
    const cfg = toConfig(form!);
    afterSave(await api.createPreset(input(name, cfg)) as PresetOf<K>, cfg);
  };
  const rename = async (name: string) => {
    // 이름만 바꾸고 저장된 내용은 그대로 둔다 (지금 고친 내용은 "수정됨"으로 남는다)
    setCurrent(await api.updatePreset(current!.id, input(name, current!.config, current!.sourceFmuId)) as PresetOf<K>);
    qc.invalidateQueries({ queryKey: ['presets'] });
  };
  const remove = useMutation({
    mutationFn: (p: PresetOf<K>) => api.deletePreset(p.id),
    onSuccess: () => {
      setCurrent(null);
      setSavedJson(null);
      setModal(null);
      qc.invalidateQueries({ queryKey: ['presets'] });
    },
  });
  useHotkeys([['mod+S', save]], []);

  const menuBar = (
    <PresetMenuBar kind={kind} fmuId={fmuId} current={current as Preset | null} dirty={dirty} onNew={newForm} onSave={save}
      onSaveAs={() => setModal('saveAs')} onRename={() => setModal('rename')} onDelete={() => setModal('delete')}
      onLoadPreset={p => loadPreset(p as PresetOf<K>)} onLoadJob={loadJob}
      menuLabel={opts.menuLabel} sticky={opts.sticky} />
  );

  const noticeEl = notice && (
    <Alert color={notice.warnings.length ? 'yellow' : 'blue'} title={notice.message} withCloseButton
      onClose={() => setNotice(null)} data-testid="load-notice">
      {notice.warnings.length > 0 && (
        <List size="sm" mb="xs">{notice.warnings.map(w => <List.Item key={w}>{w}</List.Item>)}</List>
      )}
      <Button size="compact-xs" variant="light" onClick={undo}>되돌리기</Button>
    </Alert>
  );

  const modals = (
    <>
      <PresetNameModal opened={modal === 'saveAs'} title="프리셋으로 저장" confirmLabel="저장" onClose={() => setModal(null)}
        initialName={current ? `${current.name} 복사본` : `${opts.modelName} ${KIND_LABEL[kind]}`} onSubmit={saveAs}>
        <Text size="xs" c="dimmed">{SAVE_NOTE[kind]}</Text>
      </PresetNameModal>
      <PresetNameModal opened={modal === 'rename'} title="프리셋 이름 바꾸기" confirmLabel="바꾸기" onClose={() => setModal(null)}
        initialName={current?.name ?? ''} onSubmit={rename} />
      <Modal opened={modal === 'delete'} onClose={() => setModal(null)} title="프리셋 삭제" transitionProps={{ duration: 0 }}>
        <Text size="sm">프리셋 '{current?.name}'을(를) 삭제할까요? 지금 화면의 설정은 그대로 남습니다.</Text>
        {remove.isError && <Text size="sm" c="red" mt="xs">{(remove.error as Error).message}</Text>}
        <Group justify="end" mt="md">
          <Button variant="default" onClick={() => setModal(null)}>취소</Button>
          <Button color="red" loading={remove.isPending} onClick={() => current && remove.mutate(current)}>삭제</Button>
        </Group>
      </Modal>
    </>
  );

  return { menuBar, notice: noticeEl, modals };
}
