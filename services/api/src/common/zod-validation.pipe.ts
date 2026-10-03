import { BadRequestException, type PipeTransform } from "@nestjs/common";
import { toValidationIssues, type z } from "@repo/validation";

/**
 * Validates a request value against a shared zod schema.
 * Usage: `@Body(new ZodValidationPipe(schema)) body: z.infer<typeof schema>`
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({ message: "Validation failed", issues: toValidationIssues(result.error) });
    }
    return result.data;
  }
}
