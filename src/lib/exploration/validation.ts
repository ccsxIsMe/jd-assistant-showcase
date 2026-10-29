import type { ValidationIssue } from '../ai/validation';
export class AnalysisValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(code: string, path: string, message: string, additional: ValidationIssue[] = []) {
    super(message);
    this.issues = [{ code, path, message }, ...additional].slice(0, 8);
  }
}
