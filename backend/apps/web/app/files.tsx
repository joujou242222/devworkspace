'use client';
import { useViewParam } from './view-state';
import { ProjectNavigation } from './navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  apiRequest,
  ApiRequestError,
  type fileRecord as FileRecord,
  type filePage as FilePage,
  type PrincipalDto,
  type imageReference as ImageReference,
} from '@devworkspace/contracts';
type Headers = Record<string, string>;
const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Request failed. Retry or sign in again.';
async function binary(path: string, headers: Headers) {
  const response = await fetch(path, { credentials: 'include', headers, cache: 'no-store' });
  if (!response.ok)
    throw new ApiRequestError(
      response.status === 401
        ? 'Session expired. Sign in again.'
        : response.status === 404
          ? 'File unavailable or access revoked.'
          : 'File could not be loaded. Retry.',
      response.status,
    );
  return response.blob();
}
function FileFolderSelect({
  initial,
  folders,
}: {
  initial?: string | null;
  folders: FileRecord[];
}) {
  const [value, setValue] = useState(initial ?? '');
  return (
    <select
      aria-label="Move to folder"
      name="folder_id"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    >
      <option value="">Root</option>
      {value && !folders.some((f) => f.id === value) && (
        <option value={value}>Keep current folder</option>
      )}
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
function UploadForm({
  path,
  headers,
  media = false,
  folder = null,
  purpose = 'PROJECT_FILE',
  uploaded,
}: {
  path: string;
  headers: Headers;
  media?: boolean;
  folder?: string | null;
  purpose?: 'PROJECT_FILE' | 'DELIVERABLE';
  uploaded: (row: FileRecord) => void;
}) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<{ file: File; folder: string | null; row: FileRecord } | undefined>(
    undefined,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const max = (media ? 2 : 25) * 1024 * 1024;
      if (file.size < 1 || file.size > max)
        throw new Error('Choose a nonempty file up to ' + (media ? 2 : 25) + ' MiB.');
      if (
        !(
          media ? ['image/png', 'image/jpeg'] : ['image/png', 'image/jpeg', 'application/pdf']
        ).includes(file.type)
      )
        throw new Error(media ? 'Choose a PNG or JPEG image.' : 'Choose PNG, JPEG or PDF.');
      setStatus('Calculating checksum…');
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
        (x) => x.toString(16).padStart(2, '0'),
      ).join('');
      let row =
        pending.current?.file === file && pending.current.folder === folder
          ? pending.current.row
          : undefined;
      if (!row?.capability || Date.parse(row.capability.expiresAt) <= Date.now()) {
        row = await apiRequest<FileRecord>(
          path,
          'POST',
          {
            name: file.name,
            size: file.size,
            digest,
            mime: file.type,
            ...(!media ? { purpose, folder_id: folder } : {}),
          },
          headers,
        );
        pending.current = { file, folder, row };
      }
      if (!row.capability) throw new Error('Upload capability unavailable');
      setStatus('Uploading ' + file.name + '…');
      const response = await fetch(row.capability.url, {
        method: 'PUT',
        credentials: 'omit',
        headers: row.capability.headers,
        body: file,
        redirect: 'error',
      });
      if (![200, 412].includes(response.status))
        throw new Error(
          'Upload failed (' + response.status + '). Your selection is retained for retry.',
        );
      setStatus('Finalizing upload…');
      const final = await apiRequest<FileRecord>(
        path + '/' + row.id + '/finalize',
        'POST',
        {},
        headers,
      );
      setStatus('Queued for quarantine scanning and preview processing.');
      uploaded(final);
      pending.current = undefined;
    } catch (e) {
      setError(message(e));
      setStatus('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} aria-label={media ? 'Upload image' : 'Upload file'}>
      <label>
        {media ? 'Image file' : 'Project file'}
        <input
          aria-label={media ? 'Image file' : 'Project file'}
          type="file"
          accept={media ? 'image/png,image/jpeg' : 'image/png,image/jpeg,application/pdf'}
          required
          onChange={(e) => {
            setFile(e.target.files?.[0]);
            pending.current = undefined;
            setError('');
          }}
        />
      </label>
      <p>{media ? 'PNG/JPEG, up to 2 MiB.' : 'PNG/JPEG/PDF, up to 25 MiB and 100 PDF pages.'}</p>
      <button disabled={busy}>{busy ? 'Uploading…' : error ? 'Retry upload' : 'Upload'}</button>
      {busy && <progress aria-label="Upload progress" />}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function ImageControl({
  path,
  headers = {},
  editable = true,
  label,
}: {
  path: string;
  headers?: Headers;
  editable?: boolean;
  label: string;
}) {
  const [reference, setReference] = useState<ImageReference>();
  const [upload, setUpload] = useState<FileRecord>();
  const [error, setError] = useState('');
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(headers);
  useEffect(() => {
    let alive = true;
    let url = '';
    setError('');
    setImage('');
    void (async () => {
      try {
        const r = await apiRequest<ImageReference>(path, 'GET', undefined, JSON.parse(key));
        if (!alive) return;
        setReference(r);
        if (r.asset_id) {
          url = URL.createObjectURL(await binary(path + '/content', JSON.parse(key)));
          if (alive) setImage(url);
          else URL.revokeObjectURL(url);
        }
      } catch (e) {
        if (alive) {
          setReference(undefined);
          setError(message(e));
        }
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, key, tick]);
  useEffect(() => {
    if (!upload || !['UPLOADED', 'PROCESSING'].includes(upload.status ?? '')) return;
    const timer = setInterval(() => {
      void apiRequest<FileRecord>(path + '/uploads/' + upload.id, 'GET', undefined, JSON.parse(key))
        .then(setUpload)
        .catch((e) => {
          setUpload(undefined);
          setImage('');
          setReference(undefined);
          setError(message(e));
        });
    }, 2000);
    return () => clearInterval(timer);
  }, [path, key, upload]);
  async function attach(id: string | null) {
    if (!reference) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(
        path,
        'PATCH',
        { asset_id: id },
        { ...headers, 'If-Match': '"' + reference.revision + '"' },
      );
      setUpload(undefined);
      setTick((t) => t + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={label}>
      <h2>{label}</h2>
      {image ? (
        <img src={image} width={96} height={96} style={{ objectFit: 'contain' }} alt={label} />
      ) : (
        <p>No available image.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <button onClick={() => setTick((t) => t + 1)}>Reload image</button>
      {editable && reference && (
        <>
          <UploadForm path={path + '/uploads'} headers={headers} media uploaded={setUpload} />
          {upload && (
            <div>
              <p role="status">
                Image: {upload.status} {upload.error_code}
              </p>
              {upload.status === 'READY' && (
                <button disabled={busy} onClick={() => void attach(upload.id)}>
                  Use ready image
                </button>
              )}
              {upload.status === 'FAILED' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void apiRequest<FileRecord>(
                      path + '/uploads/' + upload.id + '/retry',
                      'POST',
                      {},
                      headers,
                    )
                      .then(setUpload)
                      .catch((e) => setError(message(e)))
                  }
                >
                  Retry processing
                </button>
              )}
            </div>
          )}
          {reference.asset_id && (
            <button disabled={busy} onClick={() => void attach(null)}>
              Remove image
            </button>
          )}
        </>
      )}
    </section>
  );
}
export default function FilesWorkspace({
  orgId,
  projectId,
  principal,
  kind,
}: {
  orgId: string;
  projectId: string;
  principal: PrincipalDto;
  kind: 'files' | 'deliverables';
}) {
  const api = `/api/v1/organizations/${orgId}/projects/${projectId}`;
  const headers = { 'X-Organization-Principal': principal.id };
  const [page, setPage] = useState<FilePage>();
  const [folders, setFolders] = useState<FilePage>();
  const [uploads, setUploads] = useState<FileRecord[]>([]);
  const [project, setProject] = useState<{ name: string; status: string }>();
  const [folder, setFolder] = useViewParam<string>('folder_id', 'root');
  const [filter, setFilter] = useViewParam<string>('q', '');
  const [state, setState] = useViewParam<string>('status', 'ACTIVE');
  const [pageNumber, setPageNumber] = useViewParam<number>('page', 1);
  const [folderPage, setFolderPage] = useViewParam<number>('folder_page', 1);
  const [uploadPage, setUploadPage] = useViewParam<number>('upload_page', 1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<FileRecord>();
  const [versions, setVersions] = useState<FilePage>();
  const [versionPage, setVersionPage] = useViewParam<number>('version_page', 1);
  const [preview, setPreview] = useState('');
  const [mutationBusy, setMutationBusy] = useState(false);
  const [taskId, setTaskId] = useState('');
  const tracked = useRef<string[]>([]);
  const readySeen = useRef(new Set<string>());
  useEffect(() => {
    setTaskId(new URLSearchParams(window.location.search).get('task_id') ?? '');
  }, []);
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError('');
    void (async () => {
      try {
        const [p, f, u, record] = await Promise.all([
          apiRequest<FilePage>(
            api +
              '/' +
              kind +
              '?page=' +
              pageNumber +
              '&limit=25' +
              (kind === 'files' ? '&folder_id=' + folder + '&status=' + state : '') +
              '&q=' +
              encodeURIComponent(filter),
            'GET',
            undefined,
            headers,
          ),
          apiRequest<FilePage>(
            api + '/folders?page=' + folderPage + '&limit=100',
            'GET',
            undefined,
            headers,
          ),
          apiRequest<FilePage>(
            api + '/uploads?page=' + uploadPage + '&limit=25',
            'GET',
            undefined,
            headers,
          ),
          apiRequest<{ name: string; status: string }>(api, 'GET', undefined, headers),
        ]);
        if (alive) {
          setPage(p);
          setFolders(f);
          const extra = await Promise.all(
            tracked.current.map((id) =>
              apiRequest<FileRecord>(api + '/uploads/' + id, 'GET', undefined, headers),
            ),
          );
          if (!alive) return;
          setUploads([...extra, ...u.items.filter((row) => !tracked.current.includes(row.id))]);
          setProject(record);
        }
      } catch (e) {
        if (alive) {
          setError(message(e));
          setPage(undefined);
          setFolders(undefined);
          setUploads([]);
          setProject(undefined);
          setSelected(undefined);
          setVersions(undefined);
          setPreview('');
        }
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, kind, principal.id, pageNumber, folderPage, uploadPage, folder, state, filter, tick]);
  useEffect(() => {
    // The status read may observe READY after a parallel listing read started.
    // Fetch once more after that committed transition before stopping polling.
    const fresh = uploads.filter((u) => u.status === 'READY' && !readySeen.current.has(u.id));
    if (fresh.length) {
      for (const u of fresh) readySeen.current.add(u.id);
      refresh();
    }
    if (!uploads.some((u) => ['UPLOADED', 'PROCESSING'].includes(u.status ?? ''))) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [uploads]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    void Promise.all([
      apiRequest<FilePage>(
        api + '/deliverables/' + selected.id + '/versions?page=' + versionPage + '&limit=25',
        'GET',
        undefined,
        headers,
      ),
      apiRequest<FileRecord>(api + '/deliverables/' + selected.id, 'GET', undefined, headers),
    ])
      .then(([v, d]) => {
        if (alive) {
          setVersions(v);
          setSelected(d);
        }
      })
      .catch((e) => {
        if (alive) {
          setVersions(undefined);
          setSelected(undefined);
          setError(message(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [api, principal.id, selected?.id, tick, versionPage]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const canUpload = Boolean(page?.canUpload);
  const manager = Boolean(
    page?.manager && project && !['ARCHIVED', 'COMPLETED'].includes(project.status),
  );
  async function run(work: () => Promise<void>) {
    if (mutationBusy) return;
    setMutationBusy(true);
    setError('');
    try {
      await work();
      refresh();
    } catch (e) {
      setError(message(e));
      if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
        setPage(undefined);
        setFolders(undefined);
        setUploads([]);
        setSelected(undefined);
        setVersions(undefined);
        setPreview('');
      }
    } finally {
      setMutationBusy(false);
    }
  }
  async function show(id: string, download: boolean, pageNumber = 1) {
    await run(async () => {
      const blob = await binary(
        api + '/assets/' + id + (download ? '/download' : '/preview/' + pageNumber),
        headers,
      );
      const url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download =
          'file-' +
          id +
          (blob.type === 'application/pdf' ? '.pdf' : blob.type === 'image/jpeg' ? '.jpg' : '.png');
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else setPreview(url);
    });
  }
  const actionHeaders = (row: FileRecord) => ({ ...headers, 'If-Match': '"' + row.revision + '"' });
  const uploadFormPath = api + '/uploads';
  return (
    <section>
      <ProjectNavigation orgId={orgId} projectId={projectId} />
      <h1>
        {kind === 'files' ? 'Project files' : 'Deliverables'}
        {project ? ' — ' + project.name : ''}
      </h1>
      <button onClick={refresh}>Reload current data</button>
      {busy && <p role="status">Loading files…</p>}
      {error && (
        <p role="alert">
          {error} <a href="/login">Sign in</a>
        </p>
      )}
      {page && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPageNumber(1);
              setFilter(String(new FormData(e.currentTarget).get('search') ?? ''));
            }}
          >
            <label>
              Search
              <input name="search" defaultValue={filter} />
            </label>
            <button>Search</button>
          </form>
          {kind === 'files' && (
            <>
              <label>
                Folder
                <select
                  aria-label="Folder"
                  value={folder}
                  onChange={(e) => {
                    setFolder(e.target.value);
                    setPageNumber(1);
                  }}
                >
                  <option value="root">Root</option>
                  {folder !== 'root' && !folders?.items.some((f) => f.id === folder) && (
                    <option value={folder}>Selected folder</option>
                  )}
                  {folders?.items.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                File status
                <select
                  value={state}
                  onChange={(e) => {
                    setState(e.target.value);
                    setPageNumber(1);
                  }}
                >
                  <option>ACTIVE</option>
                  <option>ARCHIVED</option>
                </select>
              </label>
              {folders && folders.total > 100 && (
                <p>
                  <button disabled={folderPage === 1} onClick={() => setFolderPage((p) => p - 1)}>
                    Previous folders
                  </button>{' '}
                  Folder page {folderPage}{' '}
                  <button
                    disabled={folderPage * 100 >= folders.total}
                    onClick={() => setFolderPage((p) => p + 1)}
                  >
                    Next folders
                  </button>
                </p>
              )}
              {manager && (
                <>
                  <form
                    aria-label="Create folder"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const data = new FormData(form);
                      void run(async () => {
                        await apiRequest(
                          api + '/folders',
                          'POST',
                          { name: data.get('name'), position: 0 },
                          headers,
                        );
                        form.reset();
                      });
                    }}
                  >
                    <label>
                      Folder name
                      <input name="name" aria-label="Folder name" required maxLength={100} />
                    </label>
                    <button disabled={mutationBusy}>Create folder</button>
                  </form>
                  {folders?.items.map((f) => (
                    <form
                      key={f.id + ':' + f.revision}
                      aria-label={'Manage folder ' + f.name}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        void run(async () => {
                          await apiRequest(
                            api + '/folders/' + f.id,
                            'PATCH',
                            { name: data.get('name'), position: f.position },
                            actionHeaders(f),
                          );
                        });
                      }}
                    >
                      <input
                        aria-label={'Rename folder ' + f.name}
                        name="name"
                        defaultValue={f.name}
                        required
                        maxLength={100}
                      />
                      <button disabled={mutationBusy}>Rename folder</button>
                      <button
                        type="button"
                        disabled={mutationBusy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              'Remove this empty folder? File bytes and history are retained.',
                            )
                          )
                            return;
                          void run(async () => {
                            await apiRequest(
                              api + '/folders/' + f.id,
                              'DELETE',
                              {},
                              actionHeaders(f),
                            );
                            if (folder === f.id) setFolder('root');
                          });
                        }}
                      >
                        Remove empty folder
                      </button>
                    </form>
                  ))}
                </>
              )}
              {canUpload && (
                <UploadForm
                  path={uploadFormPath}
                  headers={headers}
                  folder={folder === 'root' ? null : folder}
                  uploaded={(r) => {
                    tracked.current = [r.id, ...tracked.current.filter((id) => id !== r.id)];
                    setUploads((u) => [r, ...u.filter((x) => x.id !== r.id)]);
                    refresh();
                  }}
                />
              )}
            </>
          )}
          {kind === 'deliverables' && canUpload && (
            <form
              aria-label="Create deliverable"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void run(async () => {
                  const r = await apiRequest<FileRecord>(
                    api + '/deliverables',
                    'POST',
                    {
                      title: data.get('title'),
                      description: data.get('description'),
                      task_id: String(data.get('task_id') ?? '') || null,
                      status: 'ACTIVE',
                    },
                    headers,
                  );
                  setSelected(r);
                  setVersions(undefined);
                });
              }}
            >
              <label>
                Deliverable title
                <input aria-label="Deliverable title" name="title" required maxLength={200} />
              </label>
              <label>
                Description
                <textarea name="description" maxLength={5000} />
              </label>
              <label>
                Optional task ID
                <input
                  aria-label="Optional task ID"
                  name="task_id"
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                />
              </label>
              <button disabled={mutationBusy}>Create deliverable</button>
            </form>
          )}
          {!page.items.length && <p>No {kind} in this view.</p>}
          <ul>
            {page.items.map((r) => (
              <li key={r.id}>
                <h2>{r.title}</h2>
                <p>{r.status}</p>
                {kind === 'deliverables' ? (
                  <button
                    onClick={() => {
                      setSelected(r);
                      setVersions(undefined);
                      setVersionPage(1);
                    }}
                  >
                    Open version history
                  </button>
                ) : (
                  <>
                    <button disabled={mutationBusy} onClick={() => void show(r.asset_id!, false)}>
                      Preview
                    </button>
                    <button disabled={mutationBusy} onClick={() => void show(r.asset_id!, true)}>
                      Download
                    </button>
                    {manager && (
                      <form
                        key={r.id + ':' + r.revision}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          void run(async () => {
                            await apiRequest(
                              api + '/files/' + r.id,
                              'PATCH',
                              {
                                title: data.get('title'),
                                folder_id: data.get('folder_id') || null,
                                status: data.get('status'),
                              },
                              actionHeaders(r),
                            );
                          });
                        }}
                      >
                        <label>
                          File title
                          <input name="title" defaultValue={r.title} required maxLength={200} />
                        </label>
                        <label>
                          Move to folder
                          <FileFolderSelect
                            initial={r.folder_id ?? null}
                            folders={folders?.items ?? []}
                          />
                        </label>
                        <label>
                          Listing status
                          <select name="status" defaultValue={r.status}>
                            <option>ACTIVE</option>
                            <option>ARCHIVED</option>
                          </select>
                        </label>
                        <button disabled={mutationBusy}>Save file listing</button>
                      </form>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <p>
            <button disabled={pageNumber === 1} onClick={() => setPageNumber((p) => p - 1)}>
              Previous {kind}
            </button>{' '}
            Page {pageNumber}, {page.total} records{' '}
            <button
              disabled={pageNumber * 25 >= page.total}
              onClick={() => setPageNumber((p) => p + 1)}
            >
              Next {kind}
            </button>
          </p>
          {kind === 'deliverables' && selected && (
            <section aria-label="Version history">
              <h2>Version history — {selected.title}</h2>
              <p>
                Task: {selected.task_id ?? 'Unlinked'}. Latest prepared version ID:{' '}
                {selected.latest_version_id ?? 'None'}.
              </p>
              {manager && (
                <form
                  key={selected.id + ':' + selected.revision}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    if (
                      data.get('status') === 'ARCHIVED' &&
                      selected.status !== 'ARCHIVED' &&
                      !window.confirm(
                        'Archiving this deliverable cancels its open review. Existing history remains. Continue?',
                      )
                    )
                      return;
                    void run(async () => {
                      const r = await apiRequest<FileRecord>(
                        api + '/deliverables/' + selected.id,
                        'PATCH',
                        {
                          title: data.get('title'),
                          description: data.get('description'),
                          task_id: String(data.get('task_id') ?? '') || null,
                          status: data.get('status'),
                        },
                        actionHeaders(selected),
                      );
                      setSelected(r);
                    });
                  }}
                >
                  <label>
                    Title
                    <input name="title" defaultValue={selected.title} required />
                  </label>
                  <label>
                    Description
                    <textarea name="description" defaultValue={selected.description} />
                  </label>
                  <label>
                    Linked task ID
                    <input name="task_id" defaultValue={selected.task_id ?? ''} />
                  </label>
                  <label>
                    Deliverable status
                    <select name="status" defaultValue={selected.status}>
                      <option>ACTIVE</option>
                      <option>ARCHIVED</option>
                    </select>
                  </label>
                  <button disabled={mutationBusy}>Save deliverable</button>
                </form>
              )}
              {canUpload && selected.status === 'ACTIVE' && (
                <>
                  <UploadForm
                    path={api + '/uploads'}
                    headers={headers}
                    purpose="DELIVERABLE"
                    uploaded={(r) => {
                      tracked.current = [r.id, ...tracked.current.filter((id) => id !== r.id)];
                      setUploads((u) => [r, ...u.filter((x) => x.id !== r.id)]);
                      refresh();
                    }}
                  />
                  <form
                    aria-label="Prepare version"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      void run(async () => {
                        await apiRequest(
                          api + '/deliverables/' + selected.id + '/versions',
                          'POST',
                          { asset_id: data.get('asset_id') },
                          headers,
                        );
                        setSelected(
                          await apiRequest<FileRecord>(
                            api + '/deliverables/' + selected.id,
                            'GET',
                            undefined,
                            headers,
                          ),
                        );
                      });
                    }}
                  >
                    <label>
                      Ready source
                      <select aria-label="Ready source" name="asset_id" required defaultValue="">
                        <option value="" disabled>
                          Choose verified source
                        </option>
                        {uploads
                          .filter((u) => u.status === 'READY')
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} — {u.id}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button disabled={mutationBusy}>Prepare immutable version</button>
                  </form>
                </>
              )}
              {versions?.items.length === 0 && <p>No prepared versions.</p>}
              <ol>
                {versions?.items.map((v) => (
                  <li key={v.id}>
                    <p>
                      Version {v.version_number} — {v.mime}, {v.byte_size} bytes
                    </p>
                    <p>
                      SHA-256: <code>{v.digest}</code>
                    </p>
                    <button onClick={() => void show(v.asset_id!, true)}>
                      Download version {v.version_number}
                    </button>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void show(
                          v.asset_id!,
                          false,
                          Number(new FormData(e.currentTarget).get('page')),
                        );
                      }}
                    >
                      <label>
                        Preview page
                        <input
                          aria-label={'Preview page for version ' + v.version_number}
                          name="page"
                          type="number"
                          min={1}
                          max={100}
                          defaultValue={1}
                        />
                      </label>
                      <button>Preview version {v.version_number}</button>
                    </form>
                  </li>
                ))}
              </ol>
              {versions && versions.total > 25 && (
                <>
                  <button disabled={versionPage === 1} onClick={() => setVersionPage((p) => p - 1)}>
                    Previous versions
                  </button>
                  <button
                    disabled={versionPage * 25 >= versions.total}
                    onClick={() => setVersionPage((p) => p + 1)}
                  >
                    Next versions
                  </button>
                </>
              )}
            </section>
          )}
          <section aria-label="Upload processing">
            <h2>Upload processing</h2>
            {!uploads.length && <p>No uploads.</p>}
            <ul>
              {uploads.map((u) => (
                <li key={u.id}>
                  {u.name}: <strong>{u.status}</strong> {u.error_code}
                  {u.status === 'FAILED' && canUpload && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          await apiRequest(
                            api + '/uploads/' + u.id + '/retry',
                            'POST',
                            {},
                            headers,
                          );
                        })
                      }
                    >
                      Retry processing
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button disabled={uploadPage === 1} onClick={() => setUploadPage((p) => p - 1)}>
              Previous uploads
            </button>
            <button disabled={uploads.length < 25} onClick={() => setUploadPage((p) => p + 1)}>
              Next uploads
            </button>
          </section>
          {preview && (
            <section>
              <h2>Authorized preview</h2>
              <img
                src={preview}
                alt="Verified file preview"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
              <button onClick={() => setPreview('')}>Close preview</button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
