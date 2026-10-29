import { expect, it } from 'vitest';
import { reloadReady } from './reload';

it('does not accept the departing document when reload acknowledgement arrives first', async () => {
  let generation = 1, complete = true, element = true, navigated = false, probes = 0;
  const evaluate = async (expression: string) => {
    return Function('performance', 'document', `return (${expression})`)(
      { timeOrigin: generation }, { readyState: complete ? 'complete' : 'loading', querySelector: () => element });
  };
  const send = async (method: string) => { expect(method).toBe("Page.reload"); navigated = true; };
  const waitFor = async (expression: string) => {
    expect(navigated).toBe(true);
    expect(await evaluate(expression)).toBe(false);
    generation = 2; complete = false;
    expect(await evaluate(expression)).toBe(false);
    complete = true; element = false;
    expect(await evaluate(expression)).toBe(false);
    element = true; probes++;
    expect(await evaluate(expression)).toBe(true);
    expect(expression).toContain('document.readyState');
    expect(expression).toContain('.next-action');
  };
  await reloadReady(send, evaluate, waitFor, "document.querySelector('.next-action')");
  expect(generation).toBe(2); expect(probes).toBe(1);
});
