import {
  HTMLTagSpecification,
  IHTMLTagProvider,
  ITagSet,
  IValueSets,
  collectTagsDefault,
  collectAttributesDefault,
  collectValuesDefault,
  genAttribute,
  TagProviderPriority,
  Attribute
} from './common';
import { kebabCase } from 'lodash';
import { ChildComponent } from '../../../services/vueInfoService';
import { MarkupContent } from 'vscode-languageserver-types';

export function getComponentInfoTagProvider(childComponents: ChildComponent[]): IHTMLTagProvider {
  const tagSet: ITagSet = {};
  const valueSets: IValueSets = {};

  for (const cc of childComponents) {
    const attributes: Attribute[] = [];
    if (cc.info) {
      cc.info.componentInfo.props?.forEach(p => {
        const documentation: MarkupContent = { kind: 'markdown', value: p.documentation || '' };

        // For a string-literal (union) prop type, register the static attribute form
        // (`color="primary"`) carrying a value set so its values can be auto-completed.
        // The bound form (`:color`) is a JS expression and is completed by the template
        // interpolation service instead.
        if (p.values && p.values.length > 0) {
          const valueSetName = `${cc.name}/${p.name}`;
          valueSets[valueSetName] = p.values;
          attributes.push(genAttribute(p.name, valueSetName, documentation));
          const kebabName = kebabCase(p.name);
          if (kebabName !== p.name) {
            attributes.push(genAttribute(kebabName, valueSetName, documentation));
          }
        }

        attributes.push(genAttribute(`:${p.name}`, undefined, documentation));
      });
      cc.info.componentInfo.emits?.forEach(e => {
        attributes.push(genAttribute(e.name, 'event', { kind: 'markdown', value: e.documentation || '' }));
      });
    }
    tagSet[cc.name] = new HTMLTagSpecification(
      {
        kind: 'markdown',
        value: cc.documentation || ''
      },
      attributes
    );
  }

  return {
    getId: () => 'component',
    priority: TagProviderPriority.UserCode,
    collectTags: collector => collectTagsDefault(collector, tagSet),
    collectAttributes: (
      tag: string,
      collector: (attribute: string, type?: string, documentation?: string | MarkupContent) => void
    ) => {
      collectAttributesDefault(tag, collector, tagSet, []);
    },
    collectValues: (tag: string, attribute: string, collector: (value: string) => void) => {
      collectValuesDefault(tag, attribute, collector, tagSet, [], valueSets);
    }
  };
}
