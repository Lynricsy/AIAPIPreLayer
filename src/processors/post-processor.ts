import type { PostProcessor, PostProcessorContext } from '../types/index.js';

export class PostProcessorManager {
  private processors: PostProcessor[] = [];

  getProcessors(): PostProcessor[] {
    return [...this.processors];
  }

  async process(context: PostProcessorContext): Promise<PostProcessorContext> {
    let current = context;
    for (const processor of this.processors) {
      current = await processor.process(current);
    }
    return current;
  }
}
