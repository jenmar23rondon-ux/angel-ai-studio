export async function runMockProvider(generationId: string) {
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    generationId,
    outputUrl: `https://storage.example.com/generated/${generationId}.png`,
    provider: "mock"
  };
}
