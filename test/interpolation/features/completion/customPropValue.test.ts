import { CompletionItemKind } from 'vscode';
import { position } from '../../../util';
import { getDocUri } from '../../path';
import { testCompletion } from '../../../completionHelper';

// A string-literal (union) prop type exposes its values as completions on the static
// attribute form (`color="primary"`). The cursor sits between the quotes of `color=""`.
describe('Should autocomplete static prop values from a custom string union type', () => {
  const parentUri = getDocUri('completion/customPropValue/Parent.vue');

  it('completes ColorToken values inside color="|"', async () => {
    await testCompletion(parentUri, position(2, 25), [
      { label: 'primary', kind: CompletionItemKind.Unit },
      { label: 'secondary', kind: CompletionItemKind.Unit }
    ]);
  });
});
