import type { ModelQuiz } from "./assemble";

/** A valid answer from the model: five questions, four options each. The correct option is first. */
export function modelQuiz(over: Partial<ModelQuiz> = {}): ModelQuiz {
  return {
    questions: Array.from({ length: 5 }, (_, i) => ({
      question: `Question ${i + 1}: what does part ${i + 1} of the code do?`,
      options: [`Right answer ${i + 1}`, `Wrong answer ${i + 1}a`, `Wrong answer ${i + 1}b`, `Wrong answer ${i + 1}c`],
      correctIndex: 0,
      explanation: `Because part ${i + 1} does exactly that.`,
    })),
    ...over,
  };
}
