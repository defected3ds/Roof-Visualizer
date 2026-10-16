/**
 * Commits catalog changes back to the GitHub repo, so products added in /admin survive
 * restarts and redeploys on hosts with a throwaway disk (e.g. Render). Needs GITHUB_TOKEN with
 * "Contents: read and write" on the repo. Render provides the repo and branch itself.
 */
const API = process.env.GITHUB_API_URL || 'https://api.github.com';

export interface FileChange {
  /** Repo-relative path. */
  path: string;
  /** New content, or null to delete the file. */
  content: Buffer | null;
}

export function githubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || process.env.RENDER_GIT_REPO_SLUG;
  const branch = process.env.GITHUB_BRANCH || process.env.RENDER_GIT_BRANCH;
  return token && repo && branch ? { token, repo, branch } : null;
}

export async function commitFiles(changes: FileChange[], message: string): Promise<string> {
  const cfg = githubConfig();
  if (!cfg) throw new Error('GitHub sync is not configured');
  const { token, repo, branch } = cfg;

  const gh = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${API}/repos/${repo}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${url} failed: ${res.status} ${await res.text()}`);
    return res.json();
  };

  const ref = await gh('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
  const parent = await gh('GET', `/git/commits/${ref.object.sha}`);

  const tree = await Promise.all(
    changes.map(async ({ path, content }) => {
      if (content === null) return { path, mode: '100644', type: 'blob', sha: null };
      const blob = await gh('POST', '/git/blobs', { content: content.toString('base64'), encoding: 'base64' });
      return { path, mode: '100644', type: 'blob', sha: blob.sha };
    }),
  );

  const newTree = await gh('POST', '/git/trees', { base_tree: parent.tree.sha, tree });
  const commit = await gh('POST', '/git/commits', { message, tree: newTree.sha, parents: [ref.object.sha] });
  await gh('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha });
  return commit.sha;
}
