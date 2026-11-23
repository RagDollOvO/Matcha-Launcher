/** Page bridge commands; the shared manager owns persistence and the probe queue. */
export function serverCommands(manager, changed) {
  const notify = run => async params => {
    const result = await run(params);
    changed();
    return result;
  };
  return new Map([
    ['server-state', () => manager.snapshot()],
    ['list-servers', () => manager.list()],
    ['friend-servers', () => manager.friends.list()],
    ['friend-server-info', p => manager.friends.detail(p.id)],
    ['add-server', notify(params => manager.add(params))],
    ['update-server', notify(params => manager.update(params))],
    ['remove-server', notify(p => manager.remove(p.id))],
    ['favorite-server', notify(p => manager.favorite(p.id, p.favorite))],
    ['favorite-friend-server', notify(p => manager.favoriteFriend(p.id))],
    ['save-server-layout', notify(p => manager.saveLayout(p.layout, { expected: p.expected }))],
    ['query-servers', notify(p => manager.query(p.ids))],
  ]);
}
