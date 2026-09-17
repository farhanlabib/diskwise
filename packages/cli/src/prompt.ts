import { createInterface } from 'node:readline/promises';

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

// Tests replace the ask implementation so they never touch stdin.
export const promptImpl = { ask };

export async function confirmTyped(expected: string, label: string): Promise<boolean> {
  const answer = await promptImpl.ask(`Type ${expected} to confirm ${label}: `);
  return answer.trim() === expected;
}
