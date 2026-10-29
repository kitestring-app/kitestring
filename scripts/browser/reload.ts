/** CDP acknowledges reload before the departing document has gone away. */
export async function reloadReady(
  send: (method: string) => Promise<unknown>,
  evaluate: (expression: string) => Promise<unknown>,
  waitFor: (expression: string) => Promise<void>,
  ready = "document.querySelector('.app')",
) {
  const previous = await evaluate("performance.timeOrigin");
  await send("Page.reload");
  await waitFor(`performance.timeOrigin !== ${JSON.stringify(previous)} && document.readyState === 'complete' && (${ready})`);
}
