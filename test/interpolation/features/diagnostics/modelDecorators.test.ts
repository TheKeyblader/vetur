import { getDocUri } from '../../path';
import { testDiagnostics, testNoDiagnostics } from '../../../diagnosticHelper';
import { sameLineRange } from '../../../util';
import { DiagnosticSeverity } from 'vscode';

// Type-checking of the "model" family of vue-property-decorator decorators in a parent
// template. `@VModel`, `@ModelSync` and `@PropSync` declare a prop whose name differs from
// the decorated property and whose real type lives on the property annotation. This verifies
// Vetur reads the annotation and validates the declared prop (`value` / `count` / `shade`).
describe('Should type-check props declared by @VModel / @ModelSync / @PropSync', () => {
  const rightUri = getDocUri('diagnostics/modelDecorators/ParentRight.vue');
  const wrongUri = getDocUri('diagnostics/modelDecorators/ParentWrong.vue');

  it('Shows no error when passing values that match the declared prop types', async () => {
    await testNoDiagnostics(rightUri);
  });

  it('Shows errors when passing values outside the declared prop types', async () => {
    await testDiagnostics(wrongUri, [
      {
        // `@VModel` -> `value` prop typed by the `ColorToken` annotation (bound form `:value`).
        severity: DiagnosticSeverity.Error,
        message: `Type '"tertiary"' is not assignable to type '"primary" | "secondary"'.`,
        range: sameLineRange(2, 19, 24),
        source: 'Vetur',
        code: 2322
      },
      {
        // `@ModelSync('count', ...)` -> `count` prop typed `number` (bound form `:count`).
        severity: DiagnosticSeverity.Error,
        message: `Type 'string' is not assignable to type 'number'.`,
        range: sameLineRange(3, 19, 24),
        source: 'Vetur',
        code: 2322
      },
      {
        // Static attribute form of the `value` prop (`value="tertiary"`, no `:`).
        severity: DiagnosticSeverity.Error,
        message: `Type '"tertiary"' is not assignable to type '"primary" | "secondary"'.`,
        range: sameLineRange(4, 18, 23),
        source: 'Vetur',
        code: 2322
      }
    ]);
  });
});
