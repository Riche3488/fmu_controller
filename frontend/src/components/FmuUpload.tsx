import { Alert, Stack, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api/client';

/** FMU 업로드 드롭존. 업로드가 끝나면 FMU 목록을 다시 불러온다. */
export function FmuUpload() {
  const api = useApi();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadFmu(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fmus'] }),
    onError: (e: Error) => setError(e.message),
  });

  const onDrop = (files: File[]) => {
    setError(null);
    const bad = files.find(f => !f.name.toLowerCase().endsWith('.fmu'));
    if (bad) return setError('FMU 파일(.fmu)만 업로드할 수 있습니다');
    files.forEach(f => upload.mutate(f));
  };

  return (
    <Stack>
      <Dropzone onDrop={onDrop} loading={upload.isPending} inputProps={{ 'data-testid': 'fmu-upload-input' } as object}>
        <Text ta="center" py="md">FMU 파일을 끌어다 놓거나 클릭해서 업로드하세요</Text>
      </Dropzone>
      {error && <Alert color="red">{error}</Alert>}
    </Stack>
  );
}
