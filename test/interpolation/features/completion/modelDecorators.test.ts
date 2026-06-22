import { CompletionItemKind } from 'vscode';
import { position } from '../../../util';
import { getDocUri } from '../../path';
import { testCompletion } from '../../../completionHelper';

// Completion for the props and events declared by the "model" family of vue-property-decorator
// decorators (`@VModel` -> `value`/`input`, `@ModelSync('count', 'count-change')` -> `count`/
// `count-change`, `@PropSync('shade')` -> `shade`/`update:shade`), plus value completion of a
// string-union prop on its static attribute form (`shade="primary"`).
describe('Should autocomplete props/events declared by @VModel / @ModelSync / @PropSync', () => {
  const parentUri = getDocUri('completion/modelDecorators/Parent.vue');

  it(`completes the declared props (:value / :count / :shade)`, async () => {
    await testCompletion(parentUri, position(2, 18), [
      { label: ':value', kind: CompletionItemKind.Value },
      { label: ':count', kind: CompletionItemKind.Value },
      { label: ':shade', kind: CompletionItemKind.Value }
    ]);
  });

  it(`completes the declared events (input / count-change / update:shade)`, async () => {
    await testCompletion(parentUri, position(2, 19), [
      { label: 'input', kind: CompletionItemKind.Function },
      { label: 'count-change', kind: CompletionItemKind.Function },
      { label: 'update:shade', kind: CompletionItemKind.Function }
    ]);
  });

  it(`completes string-union values inside shade="|"`, async () => {
    await testCompletion(parentUri, position(3, 25), [
      { label: 'primary', kind: CompletionItemKind.Unit },
      { label: 'secondary', kind: CompletionItemKind.Unit }
    ]);
  });
});
