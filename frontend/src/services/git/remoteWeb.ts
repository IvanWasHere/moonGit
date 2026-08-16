/**
 * A remote's browsable web address (PLAN.md §11, 8.9).
 *
 * moonGit has no GitHub integration and is not getting one — a token, an API
 * client and a rate limiter to render a list this app cannot act on is a large
 * amount of machinery for a read-only panel. What "Pull Requests" can honestly
 * mean in a local git client is *take me to them*, and that needs one thing:
 * turning the remote git people actually configure into an https URL.
 *
 * Three forms exist in the wild and only one of them is a URL:
 *
 *     git@github.com:owner/repo.git          scp-like, no scheme, colon not slash
 *     ssh://git@github.com/owner/repo.git    a real URL, but not browsable
 *     https://github.com/owner/repo.git      already right, bar the suffix
 *
 * Returns null rather than guessing for anything else — a local path, an
 * unknown scheme, a host with no path. A caller that cannot build a link should
 * say so, not open a browser on something invented.
 */

export interface RemoteWeb {
  readonly host: string;
  /** `owner/repo`, with any `.git` removed. */
  readonly path: string;
  /** `https://host/owner/repo` */
  readonly url: string;
}

export function remoteWeb(remoteUrl: string): RemoteWeb | null {
  const raw = remoteUrl.trim();
  if (raw === '') return null;

  // scp-like: `user@host:path`, which has no `//` and a colon before any slash.
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(raw);
  const viaScp = scp !== null && !raw.includes('://');

  let host: string;
  let path: string;

  if (viaScp) {
    host = scp?.[1] ?? '';
    path = scp?.[2] ?? '';
  } else {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    // `file:` and anything else local has nothing to browse to.
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(parsed.protocol)) return null;
    host = parsed.hostname;
    path = parsed.pathname;
  }

  path = path.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (host === '' || path === '') return null;

  return { host, path, url: `https://${host}/${path}` };
}

/**
 * Where a host keeps its pull requests.
 *
 * GitHub and GitLab disagree on the word, and getting it wrong lands on a 404
 * rather than anywhere useful. Anything unrecognised gets the repository's own
 * page, which is a worse answer than the right one and a much better answer
 * than a broken link.
 */
export function pullRequestsUrl(remoteUrl: string): string | null {
  const web = remoteWeb(remoteUrl);
  if (web === null) return null;
  if (web.host.includes('gitlab')) return `${web.url}/-/merge_requests`;
  if (web.host.includes('bitbucket')) return `${web.url}/pull-requests`;
  if (web.host.includes('github')) return `${web.url}/pulls`;
  return web.url;
}

/** The releases page, for "What's New". Same caveat about unknown hosts. */
export function releasesUrl(remoteUrl: string): string | null {
  const web = remoteWeb(remoteUrl);
  if (web === null) return null;
  if (web.host.includes('gitlab')) return `${web.url}/-/releases`;
  if (web.host.includes('github')) return `${web.url}/releases`;
  return web.url;
}
