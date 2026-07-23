const blockedTerms = ["impersonate public figure", "non-consensual", "deepfake abuse"];

export function assertPromptAllowed(prompt: string) {
  const normalized = prompt.toLowerCase();
  const match = blockedTerms.find((term) => normalized.includes(term));

  if (match) {
    throw new Error(`Prompt rejected by safety policy: ${match}`);
  }
}
