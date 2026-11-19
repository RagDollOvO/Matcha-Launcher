// Optional manifest field. Older SDK packages do not need an update channel.
export function validUpdateDeclaration(u) {
  return u?.type === 'github-release' && typeof u.repo === 'string' &&
    /^[a-z\d][a-z\d-]{0,38}\/[a-z\d._-]{1,100}$/i.test(u.repo) && !['.', '..'].includes(u.repo.split('/')[1]) &&
    (u.asset === undefined || typeof u.asset === 'string' && /^[-a-z\d_.*+ ]{1,120}\.zip$/i.test(u.asset));
}
