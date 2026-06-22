import { getDocUri } from '../../path';
import { testDiagnostics, testNoDiagnostics } from '../../../diagnosticHelper';
import { sameLineRange } from '../../../util';
import { DiagnosticSeverity } from 'vscode';

// Type-checking of `vue-property-decorator` props whose type is a custom TypeScript type
// (e.g. `type ColorToken = 'primary' | 'secondary'`). The type lives on the property
// annotation, not on the decorator argument, so this verifies that Vetur reads the
// annotation and uses it when validating the prop in a parent template.
describe('Should type-check custom prop types of vue-property-decorator components', () => {
  const rightUri = getDocUri('diagnostics/customPropType/ParentRight.vue');
  const wrongUri = getDocUri('diagnostics/customPropType/ParentWrong.vue');

  it('Shows no error when passing values that match the custom type', async () => {
    await testNoDiagnostics(rightUri);
  });

  it('Shows errors when passing values outside the custom type union', async () => {
    await testDiagnostics(wrongUri, [
      {
        severity: DiagnosticSeverity.Error,
        message: `Type '"tertiary"' is not assignable to type '"primary" | "secondary"'.`,
        range: sameLineRange(2, 19, 24),
        source: 'Vetur',
        code: 2322
      },
      {
        severity: DiagnosticSeverity.Error,
        message: `Type '"ghost"' is not assignable to type '"solid" | "outline"'.`,
        range: sameLineRange(3, 19, 26),
        source: 'Vetur',
        code: 2322
      },
      {
        // A named interface (`Badge`) is expanded structurally, so the prop type is the
        // object shape and not `any`. Asserted as a prefix (the harness prefix-matches),
        // since the full message also spells out the whole target object type.
        severity: DiagnosticSeverity.Error,
        message: `Type 'number' is not assignable to type '{ count: number;`,
        range: sameLineRange(4, 19, 24),
        source: 'Vetur',
        code: 2322
      },
      {
        // Static attribute form (`color="tertiary"`, no `:`) must be type-checked too.
        severity: DiagnosticSeverity.Error,
        message: `Type '"tertiary"' is not assignable to type '"primary" | "secondary"'.`,
        range: sameLineRange(5, 18, 23),
        source: 'Vetur',
        code: 2322
      }
    ]);
  });
});
