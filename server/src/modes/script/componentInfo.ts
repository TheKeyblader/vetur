import _ from 'lodash';
import type ts from 'typescript';
import { BasicComponentInfo } from '../../config';
import { RuntimeLibrary } from '../../services/dependencyService';
import {
  VueFileInfo,
  EmitInfo,
  PropInfo,
  ComputedInfo,
  DataInfo,
  MethodInfo,
  ChildComponent
} from '../../services/vueInfoService';
import { VueVersion } from '../../utils/vueVersion';
import { analyzeComponentsDefine } from './childComponents';
import { getGlobalComponents } from './globalComponents';

export function getComponentInfo(
  tsModule: RuntimeLibrary['typescript'],
  service: ts.LanguageService,
  fileFsPath: string,
  globalComponentInfos: BasicComponentInfo[],
  vueVersion: VueVersion,
  config: any
): VueFileInfo | undefined {
  const program = service.getProgram();
  if (!program) {
    return undefined;
  }

  const sourceFile = program.getSourceFile(fileFsPath);
  if (!sourceFile) {
    return undefined;
  }

  const checker = program.getTypeChecker();

  const defaultExportNode = getDefaultExportNode(tsModule, sourceFile);
  if (!defaultExportNode) {
    return undefined;
  }

  const vueFileInfo = analyzeDefaultExportExpr(tsModule, defaultExportNode, checker, vueVersion);

  const defaultExportType = checker.getTypeAtLocation(defaultExportNode);
  const componentsDefineInfo = analyzeComponentsDefine(
    tsModule,
    defaultExportType,
    checker,
    config.vetur.completion.tagCasing
  );

  if (componentsDefineInfo) {
    const { list: internalChildComponents, ...defineInfo } = componentsDefineInfo;
    const childComponents: ChildComponent[] = [];
    internalChildComponents.forEach(c => {
      childComponents.push({
        name: c.name,
        documentation: c.documentation,
        definition: c.definition,
        global: false,
        info: c.defaultExportNode
          ? analyzeDefaultExportExpr(tsModule, c.defaultExportNode, checker, vueVersion)
          : undefined
      });
    });
    vueFileInfo.componentInfo.childComponents = childComponents;
    vueFileInfo.componentInfo.componentsDefine = defineInfo;
  }

  const globalComponents = getGlobalComponents(
    tsModule,
    service,
    globalComponentInfos,
    config.vetur.completion.tagCasing
  );
  if (globalComponents.length > 0) {
    vueFileInfo.componentInfo.childComponents = [
      ...(vueFileInfo.componentInfo.childComponents ?? []),
      ...globalComponents.map(c => ({
        name: c.name,
        documentation: c.documentation,
        definition: c.definition,
        global: true,
        info: c.defaultExportNode
          ? analyzeDefaultExportExpr(tsModule, c.defaultExportNode, checker, vueVersion)
          : undefined
      }))
    ];
  }

  return vueFileInfo;
}

export function analyzeDefaultExportExpr(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportNode: ts.Node,
  checker: ts.TypeChecker,
  vueVersion: VueVersion
): VueFileInfo {
  const defaultExportType = checker.getTypeAtLocation(defaultExportNode);

  const insertInOptionAPIPos = getInsertInOptionAPIPos(tsModule, defaultExportType, checker);
  const emits = getEmits(tsModule, defaultExportType, checker);
  const props = getProps(tsModule, defaultExportType, checker, vueVersion);
  const data = getData(tsModule, defaultExportType, checker);
  const computed = getComputed(tsModule, defaultExportType, checker);
  const methods = getMethods(tsModule, defaultExportType, checker);

  return {
    componentInfo: {
      insertInOptionAPIPos,
      emits,
      props,
      data,
      computed,
      methods
    }
  };
}

export function getDefaultExportNode(
  tsModule: RuntimeLibrary['typescript'],
  sourceFile: ts.SourceFile
): ts.Node | undefined {
  const exportStmts = sourceFile.statements.filter(
    st => st.kind === tsModule.SyntaxKind.ExportAssignment || st.kind === tsModule.SyntaxKind.ClassDeclaration
  );
  if (exportStmts.length === 0) {
    return undefined;
  }
  const exportNode =
    exportStmts[0].kind === tsModule.SyntaxKind.ExportAssignment
      ? (exportStmts[0] as ts.ExportAssignment).expression
      : (exportStmts[0] as ts.ClassDeclaration);

  return getNodeFromExportNode(tsModule, exportNode);
}

function getInsertInOptionAPIPos(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker
) {
  if (isClassType(tsModule, defaultExportType)) {
    const decoratorArgumentType = getClassDecoratorArgumentType(tsModule, defaultExportType, checker);
    if (decoratorArgumentType && decoratorArgumentType.symbol.valueDeclaration) {
      return decoratorArgumentType.symbol.valueDeclaration.getStart() + 1;
    }
  } else if (defaultExportType.symbol?.valueDeclaration) {
    return defaultExportType.symbol.valueDeclaration.getStart() + 1;
  }
  return undefined;
}

function getDecorators(
  tsModule: RuntimeLibrary['typescript'],
  node: ts.MethodDeclaration | ts.PropertyDeclaration | undefined
) {
  if (!node) {
    return undefined;
  }
  return tsModule.getDecorators?.(node) ?? node.decorators;
}

function getEmits(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker
): EmitInfo[] | undefined {
  // When there is @Emit and emits option both, use only emits option.
  const result: EmitInfo[] = getClassAndObjectInfo(
    tsModule,
    defaultExportType,
    checker,
    getClassEmits,
    getObjectEmits,
    true
  );

  return result.length === 0 ? undefined : result;

  function getEmitValidatorInfo(propertyValue: ts.Node): { hasValidator: boolean; typeString?: string } {
    /**
     * case `foo: null`
     */
    if (propertyValue.kind === tsModule.SyntaxKind.NullKeyword) {
      return { hasValidator: false };
    }

    /**
     * case `foo: function() {}` or `foo: () => {}`
     */
    if (tsModule.isFunctionExpression(propertyValue) || tsModule.isArrowFunction(propertyValue)) {
      let typeParameterText = '';
      if (propertyValue.typeParameters) {
        typeParameterText = `<${propertyValue.typeParameters.map(tp => tp.getText()).join(', ')}>`;
      }
      const parameterText = `(${propertyValue.parameters
        .map(p => `${p.getText()}${p.type ? '' : ': any'}`)
        .join(', ')})`;
      const typeString = `${typeParameterText}${parameterText} => any`;
      return { hasValidator: true, typeString };
    }

    return { hasValidator: false };
  }

  function getClassEmits(type: ts.Type) {
    const emitDecoratorNames = ['Emit'];
    const emitsSymbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.MethodDeclaration) &&
          getPropertyDecoratorNames(tsModule, property).some(decoratorName =>
            emitDecoratorNames.includes(decoratorName)
          )
      );

    // There maybe same emit name because @Emit can be put on multiple methods.
    const emitInfoMap = new Map<string, EmitInfo>();
    emitsSymbols.forEach(emitSymbol => {
      const emit = emitSymbol.valueDeclaration as ts.MethodDeclaration;
      const decoratorExpr = getDecorators(tsModule, emit)?.find(decorator =>
        tsModule.isCallExpression(decorator.expression)
          ? emitDecoratorNames.includes(decorator.expression.expression.getText())
          : false
      )?.expression as ts.CallExpression;
      const decoratorArgs = decoratorExpr.arguments;

      let name = _.kebabCase(emitSymbol.name);
      if (decoratorArgs.length > 0) {
        const firstNode = decoratorArgs[0];
        if (tsModule.isStringLiteral(firstNode)) {
          name = firstNode.text;
        }
      }

      let typeString: string | undefined = undefined;
      const signature = checker.getSignatureFromDeclaration(emit);
      if (signature) {
        const returnType = checker.getReturnTypeOfSignature(signature);
        typeString = `(${checker.typeToString(returnType)})`;
        if (typeString === '(void)') {
          typeString = '(undefined)';
        }
      }

      if (emitInfoMap.has(name)) {
        const oldEmitInfo = emitInfoMap.get(name)!;
        if (typeString) {
          // create union type
          oldEmitInfo.typeString += ` | ${typeString}`;
        } else {
          // remove type (because it failed to obtain the type)
          oldEmitInfo.typeString = undefined;
        }
        oldEmitInfo.documentation += `\n\n${buildDocumentation(tsModule, emitSymbol, checker)}`;
        emitInfoMap.set(name, oldEmitInfo);
      } else {
        emitInfoMap.set(name, {
          name,
          hasValidator: false,
          typeString,
          documentation: buildDocumentation(tsModule, emitSymbol, checker)
        });
      }
    });

    emitInfoMap.forEach(info => {
      if (info.typeString) {
        info.typeString = `(arg: ${info.typeString}) => any`;
      }
    });

    // `@PropSync` / `@ModelSync` / `@VModel` declare an implicit update event in addition to
    // their prop, so the parent can listen to it (`@update:name` / `@change` / `@input`) with
    // a typed handler. Method `@Emit` of the same name (unlikely) takes precedence.
    getClassPropEventEmits(type).forEach(info => {
      if (!emitInfoMap.has(info.name)) {
        emitInfoMap.set(info.name, info);
      }
    });

    return emitInfoMap.size === 0 ? undefined : [...emitInfoMap.values()];
  }

  /**
   * Collect the implicit events emitted by property decorators:
   *  - `@VModel(options)`                       -> `input`
   *  - `@ModelSync('prop', 'event', options)`   -> `event`
   *  - `@PropSync('prop', options)`             -> `update:prop`
   * The event payload type is the property's annotated type when it can be expressed
   * self-contained (otherwise the emit stays untyped but still completable).
   */
  function getClassPropEventEmits(type: ts.Type): EmitInfo[] {
    const eventEmitDecoratorNames = ['VModel', 'ModelSync', 'PropSync'];
    const symbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.PropertyDeclaration) &&
          getPropertyDecoratorNames(tsModule, property).some(decoratorName =>
            eventEmitDecoratorNames.includes(decoratorName)
          )
      );

    const result: EmitInfo[] = [];
    symbols.forEach(propSymbol => {
      const prop = propSymbol.valueDeclaration as ts.PropertyDeclaration;
      const decoratorExpr = getDecorators(tsModule, prop)?.find(decorator =>
        tsModule.isCallExpression(decorator.expression)
          ? eventEmitDecoratorNames.includes(decorator.expression.expression.getText())
          : false
      )?.expression as ts.CallExpression | undefined;
      if (!decoratorExpr) {
        return;
      }
      const decoratorName = decoratorExpr.expression.getText();
      const [firstNode, secondNode] = decoratorExpr.arguments;

      let eventName: string | undefined;
      if (decoratorName === 'VModel') {
        eventName = 'input';
      } else if (decoratorName === 'ModelSync' && tsModule.isStringLiteral(secondNode)) {
        eventName = secondNode.text;
      } else if (decoratorName === 'PropSync' && tsModule.isStringLiteral(firstNode)) {
        eventName = `update:${firstNode.text}`;
      }
      if (!eventName) {
        return;
      }

      const propType = checker.getTypeOfSymbolAtLocation(propSymbol, prop);
      const valueTypeString = getSelfContainedTypeString(tsModule, propType, prop, checker);

      result.push({
        name: eventName,
        hasValidator: false,
        typeString: valueTypeString ? `(arg: ${valueTypeString}) => any` : undefined,
        documentation: buildDocumentation(tsModule, propSymbol, checker)
      });
    });

    return result;
  }

  function getObjectEmits(type: ts.Type) {
    const emitsSymbol = checker.getPropertyOfType(type, 'emits');
    if (!emitsSymbol || !emitsSymbol.valueDeclaration) {
      return undefined;
    }

    const emitsDeclaration = getLastChild(emitsSymbol.valueDeclaration);
    if (!emitsDeclaration) {
      return undefined;
    }

    /**
     * Plain array emits like `emits: ['foo', 'bar']`
     */
    if (emitsDeclaration.kind === tsModule.SyntaxKind.ArrayLiteralExpression) {
      return (emitsDeclaration as ts.ArrayLiteralExpression).elements
        .filter(expr => expr.kind === tsModule.SyntaxKind.StringLiteral)
        .map(expr => {
          return {
            name: (expr as ts.StringLiteral).text,
            hasValidator: false,
            documentation: `\`\`\`js\n${formatJSLikeDocumentation(
              emitsDeclaration.parent.getFullText().trim()
            )}\n\`\`\`\n`
          };
        });
    }

    /**
     * Object literal emits like
     * ```
     * {
     *   emits: {
     *     foo: () => true,
     *     bar: (arg1: string, arg2: number) => arg1.startsWith('s') || arg2 > 0,
     *     car: null
     *   }
     * }
     * ```
     */
    if (emitsDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
      const emitsType = checker.getTypeOfSymbolAtLocation(emitsSymbol, emitsDeclaration);

      return checker.getPropertiesOfType(emitsType).map(s => {
        const node = getNodeFromSymbol(s);
        const status =
          node !== undefined && tsModule.isPropertyAssignment(node)
            ? getEmitValidatorInfo(node.initializer)
            : { hasValidator: false };

        return {
          name: s.name,
          ...status,
          documentation: buildDocumentation(tsModule, s, checker)
        };
      });
    }

    return undefined;
  }
}

function getProps(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker,
  vueVersion: VueVersion
): PropInfo[] | undefined {
  const result: PropInfo[] = markPropBoundToModel(
    defaultExportType,
    getClassAndObjectInfo(tsModule, defaultExportType, checker, getClassProps, getObjectProps)
  );

  return result.length === 0 ? undefined : result;

  function markPropBoundToModel(type: ts.Type, props: PropInfo[]) {
    const vModelPropName = vueVersion === VueVersion.V30 ? 'modelValue' : 'value';

    function markValuePropBoundToModel() {
      return props.map(prop => {
        if (prop.name === vModelPropName) {
          prop.isBoundToModel = true;
        }
        return prop;
      });
    }

    const modelSymbol = checker.getPropertyOfType(type, 'model');
    const modelValue = (modelSymbol?.valueDeclaration as ts.PropertyAssignment)?.initializer;
    // Set value prop when no model def
    if (!modelSymbol || !modelValue) {
      return markValuePropBoundToModel();
    }

    const modelType = checker.getTypeOfSymbolAtLocation(modelSymbol, modelValue);
    const modelPropSymbol = checker.getPropertyOfType(modelType, 'prop');
    const modelPropValue = (modelPropSymbol?.valueDeclaration as ts.PropertyAssignment)?.initializer;
    if (!modelPropValue || !tsModule.isStringLiteral(modelPropValue)) {
      return markValuePropBoundToModel();
    }

    return props.map(prop => {
      if (prop.name === modelPropValue.text) {
        prop.isBoundToModel = true;
      }
      return prop;
    });
  }

  function getPropValidatorInfo(propertyValue: ts.Node | undefined): {
    hasObjectValidator: boolean;
    required: boolean;
    typeString?: string;
  } {
    if (!propertyValue) {
      return { hasObjectValidator: false, required: true };
    }

    let typeString: string | undefined = undefined;
    let typeDeclaration: ts.Identifier | ts.AsExpression | undefined = undefined;

    /**
     * case `foo: { type: String }`
     * extract type value: `String`
     */
    if (tsModule.isObjectLiteralExpression(propertyValue)) {
      const propertyValueSymbol = checker.getTypeAtLocation(propertyValue).symbol;
      const typeValue = propertyValueSymbol?.members?.get('type' as ts.__String)?.valueDeclaration;
      if (typeValue && tsModule.isPropertyAssignment(typeValue)) {
        if (tsModule.isIdentifier(typeValue.initializer) || tsModule.isAsExpression(typeValue.initializer)) {
          typeDeclaration = typeValue.initializer;
        }
      }
    } else {
      /**
       * case `foo: String`
       * extract type value: `String`
       */
      if (tsModule.isIdentifier(propertyValue) || tsModule.isAsExpression(propertyValue)) {
        typeDeclaration = propertyValue;
      }
    }

    if (typeDeclaration) {
      /**
       * `String` case
       *
       * Per https://vuejs.org/v2/guide/components-props.html#Type-Checks, handle:
       *
       * String
       * Number
       * Boolean
       * Array
       * Object
       * Date
       * Function
       * Symbol
       */
      if (tsModule.isIdentifier(typeDeclaration)) {
        const vueTypeCheckConstructorToTSType: Record<string, string> = {
          String: 'string',
          Number: 'number',
          Boolean: 'boolean',
          Array: 'any[]',
          Object: 'object',
          Date: 'Date',
          Function: 'Function',
          Symbol: 'Symbol'
        };
        const vueTypeString = typeDeclaration.getText();
        if (vueTypeCheckConstructorToTSType[vueTypeString]) {
          typeString = vueTypeCheckConstructorToTSType[vueTypeString];
        }
      } else if (
        /**
         * `String as PropType<'a' | 'b'>` case
         */
        tsModule.isAsExpression(typeDeclaration) &&
        tsModule.isTypeReferenceNode(typeDeclaration.type) &&
        ['PropType', 'Vue.PropType'].includes(typeDeclaration.type.typeName.getText()) &&
        typeDeclaration.type.typeArguments &&
        typeDeclaration.type.typeArguments[0]
      ) {
        const extractedPropType = typeDeclaration.type.typeArguments[0];
        typeString = extractedPropType.getText();
      }
    }

    if (
      !propertyValue ||
      (!tsModule.isObjectLiteralExpression(propertyValue) && !tsModule.isIdentifier(propertyValue))
    ) {
      return { hasObjectValidator: false, required: true, typeString };
    }

    const propertyValueSymbol = checker.getTypeAtLocation(propertyValue).symbol;
    const requiredValue = propertyValueSymbol?.members?.get('required' as ts.__String)?.valueDeclaration;
    const defaultValue = propertyValueSymbol?.members?.get('default' as ts.__String)?.valueDeclaration;
    if (!requiredValue && !defaultValue) {
      return { hasObjectValidator: false, required: true, typeString };
    }

    const required = Boolean(
      requiredValue &&
        tsModule.isPropertyAssignment(requiredValue) &&
        requiredValue?.initializer.kind === tsModule.SyntaxKind.TrueKeyword
    );

    return { hasObjectValidator: true, required, typeString };
  }

  function getClassProps(type: ts.Type) {
    // `vue-property-decorator` decorators that declare a prop on the component:
    //  - `@Prop(options)`                              -> prop named after the property
    //  - `@Model('event', options)`                    -> prop named after the property, v-model bound
    //  - `@PropSync('name', options)`                  -> prop named `name` (property is the `.sync` proxy)
    //  - `@ModelSync('name', 'event', options)`        -> prop named `name`, v-model bound
    //  - `@VModel(options)`                            -> prop named `value`, v-model bound
    const propDecoratorNames = ['Prop', 'Model', 'PropSync', 'ModelSync', 'VModel'];
    const propsSymbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.PropertyDeclaration) &&
          getPropertyDecoratorNames(tsModule, property).some(decoratorName =>
            propDecoratorNames.includes(decoratorName)
          )
      );
    if (propsSymbols.length === 0) {
      return undefined;
    }

    return propsSymbols.map(propSymbol => {
      const prop = propSymbol.valueDeclaration as ts.PropertyDeclaration;
      const decoratorExpr = getDecorators(tsModule, prop)?.find(decorator =>
        tsModule.isCallExpression(decorator.expression)
          ? propDecoratorNames.includes(decorator.expression.expression.getText())
          : false
      )?.expression as ts.CallExpression;
      const decoratorName = decoratorExpr.expression.getText();
      const [firstNode, secondNode, thirdNode] = decoratorExpr.arguments;

      // With `vue-property-decorator` the decorator only carries the *runtime* type
      // (e.g. `@Prop(String)` / `@Prop({ type: String })`) while the real prop type is
      // declared as a TypeScript annotation on the property itself
      // (e.g. `@Prop() readonly color!: ColorToken`). Prefer that annotation so custom
      // types (`type ColorToken = 'primary' | 'secondary'`) are preserved when the prop is
      // type-checked in parent templates. Falls back to the decorator type when the
      // property has no usable annotation.
      const propType = checker.getTypeOfSymbolAtLocation(propSymbol, prop);
      const annotatedTypeString = getSelfContainedTypeString(tsModule, propType, prop, checker);
      const values = getStringLiteralValues(tsModule, propType, checker);
      const documentation = buildDocumentation(tsModule, propSymbol, checker);

      // `@PropSync('name', options)` / `@ModelSync('name', 'event', options)`: the declared
      // prop is named by the first string argument (the property itself proxies it as a
      // computed). `@ModelSync` additionally binds the prop to v-model.
      if ((decoratorName === 'PropSync' || decoratorName === 'ModelSync') && tsModule.isStringLiteral(firstNode)) {
        const validatorInfo = getPropValidatorInfo(decoratorName === 'ModelSync' ? thirdNode : secondNode);
        return {
          name: firstNode.text,
          ...validatorInfo,
          typeString: annotatedTypeString ?? validatorInfo.typeString,
          values,
          isBoundToModel: decoratorName === 'ModelSync',
          documentation
        };
      }

      // `@VModel(options)` always declares the v-model prop named `value`.
      if (decoratorName === 'VModel') {
        const validatorInfo = getPropValidatorInfo(firstNode);
        return {
          name: 'value',
          ...validatorInfo,
          typeString: annotatedTypeString ?? validatorInfo.typeString,
          values,
          isBoundToModel: true,
          documentation
        };
      }

      // `@Prop(options)` / `@Model('event', options)`: the prop keeps the property's own name.
      const validatorInfo = getPropValidatorInfo(decoratorName === 'Model' ? secondNode : firstNode);
      return {
        name: propSymbol.name,
        ...validatorInfo,
        typeString: annotatedTypeString ?? validatorInfo.typeString,
        values,
        isBoundToModel: decoratorName === 'Model',
        documentation
      };
    });
  }

  function getObjectProps(type: ts.Type) {
    const propsSymbol = checker.getPropertyOfType(type, 'props');
    if (!propsSymbol || !propsSymbol.valueDeclaration) {
      return undefined;
    }

    const propsDeclaration = getLastChild(propsSymbol.valueDeclaration);
    if (!propsDeclaration) {
      return undefined;
    }

    /**
     * Plain array props like `props: ['foo', 'bar']`
     */
    if (propsDeclaration.kind === tsModule.SyntaxKind.ArrayLiteralExpression) {
      return (propsDeclaration as ts.ArrayLiteralExpression).elements
        .filter(expr => expr.kind === tsModule.SyntaxKind.StringLiteral)
        .map(expr => {
          return {
            name: (expr as ts.StringLiteral).text,
            hasObjectValidator: false,
            required: true,
            isBoundToModel: false,
            documentation: `\`\`\`js\n${formatJSLikeDocumentation(
              propsDeclaration.parent.getFullText().trim()
            )}\n\`\`\`\n`
          };
        });
    }

    /**
     * Object literal props like
     * ```
     * {
     *   props: {
     *     foo: { type: Boolean, default: true },
     *     bar: { type: String, default: 'bar' },
     *     car: String
     *   }
     * }
     * ```
     */
    if (propsDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
      const propsType = checker.getTypeOfSymbolAtLocation(propsSymbol, propsDeclaration);

      return checker.getPropertiesOfType(propsType).map(s => {
        const node = getNodeFromSymbol(s);
        const status =
          node !== undefined && tsModule.isPropertyAssignment(node)
            ? getPropValidatorInfo(node.initializer)
            : { hasObjectValidator: false, required: true };

        return {
          name: s.name,
          ...status,
          isBoundToModel: false,
          documentation: buildDocumentation(tsModule, s, checker)
        };
      });
    }

    return undefined;
  }
}

/**
 * In SFC, data can only be a function
 * ```
 * {
 *   data() {
 *     return {
 *        foo: true,
 *        bar: 'bar'
 *     }
 *   }
 * }
 * ```
 */
function getData(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker
): DataInfo[] | undefined {
  const result: DataInfo[] = getClassAndObjectInfo(tsModule, defaultExportType, checker, getClassData, getObjectData);
  return result.length === 0 ? undefined : result;

  function getClassData(type: ts.Type) {
    // `@PropSync` / `@ModelSync` / `@VModel` proxy properties are computed, not data; `@Inject`
    // / `@InjectReactive` stay reactive members reachable from the template (treated as data).
    const noDataDecoratorNames = [
      'Prop',
      'Model',
      'PropSync',
      'ModelSync',
      'VModel',
      'Provide',
      'ProvideReactive',
      'Ref'
    ];
    const dataSymbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.PropertyDeclaration) &&
          !getPropertyDecoratorNames(tsModule, property).some(decoratorName =>
            noDataDecoratorNames.includes(decoratorName)
          ) &&
          !property.name.startsWith('_') &&
          !property.name.startsWith('$')
      );
    if (dataSymbols.length === 0) {
      return undefined;
    }

    return dataSymbols.map(data => {
      return {
        name: data.name,
        documentation: buildDocumentation(tsModule, data, checker)
      };
    });
  }

  function getObjectData(type: ts.Type) {
    const dataSymbol = checker.getPropertyOfType(type, 'data');
    if (!dataSymbol || !dataSymbol.valueDeclaration) {
      return undefined;
    }

    const dataType = checker.getTypeOfSymbolAtLocation(dataSymbol, dataSymbol.valueDeclaration);
    const dataSignatures = dataType.getCallSignatures();
    if (dataSignatures.length === 0) {
      return undefined;
    }
    const dataReturnTypeProperties = checker.getReturnTypeOfSignature(dataSignatures[0]);
    return dataReturnTypeProperties.getProperties().map(s => {
      return {
        name: s.name,
        documentation: buildDocumentation(tsModule, s, checker)
      };
    });
  }
}

function getComputed(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker
): ComputedInfo[] | undefined {
  const result: ComputedInfo[] = getClassAndObjectInfo(
    tsModule,
    defaultExportType,
    checker,
    getClassComputed,
    getObjectComputed
  );
  return result.length === 0 ? undefined : result;

  function getClassComputed(type: ts.Type) {
    const getAccessorSymbols = type
      .getProperties()
      .filter(property => property.valueDeclaration?.kind === tsModule.SyntaxKind.GetAccessor);
    const setAccessorSymbols = defaultExportType
      .getProperties()
      .filter(property => property.valueDeclaration?.kind === tsModule.SyntaxKind.SetAccessor);

    // `@PropSync` / `@ModelSync` / `@VModel` turn the decorated property into a computed proxy
    // (get/set backed by the prop + emit), so expose it as a computed member of the component.
    const computedDecoratorNames = ['PropSync', 'ModelSync', 'VModel'];
    const decoratorComputedSymbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.PropertyDeclaration) &&
          getPropertyDecoratorNames(tsModule, property).some(decoratorName =>
            computedDecoratorNames.includes(decoratorName)
          )
      );

    if (getAccessorSymbols.length === 0 && decoratorComputedSymbols.length === 0) {
      return undefined;
    }

    const accessorComputed = getAccessorSymbols.map(computed => {
      const setComputed = setAccessorSymbols.find(setAccessor => setAccessor.name === computed.name);
      return {
        name: computed.name,
        documentation:
          buildDocumentation(tsModule, computed, checker) +
          (setComputed !== undefined ? buildDocumentation(tsModule, setComputed, checker) : '')
      };
    });

    const decoratorComputed = decoratorComputedSymbols.map(computed => ({
      name: computed.name,
      documentation: buildDocumentation(tsModule, computed, checker)
    }));

    return [...accessorComputed, ...decoratorComputed];
  }

  function getObjectComputed(type: ts.Type) {
    const computedSymbol = checker.getPropertyOfType(type, 'computed');
    if (!computedSymbol || !computedSymbol.valueDeclaration) {
      return undefined;
    }

    const computedDeclaration = getLastChild(computedSymbol.valueDeclaration);
    if (!computedDeclaration) {
      return undefined;
    }

    if (computedDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
      const computedType = checker.getTypeOfSymbolAtLocation(computedSymbol, computedDeclaration);

      return checker.getPropertiesOfType(computedType).map(s => {
        return {
          name: s.name,
          documentation: buildDocumentation(tsModule, s, checker)
        };
      });
    }
  }
}

function isInternalHook(methodName: string) {
  const $internalHooks = [
    'data',
    'beforeCreate',
    'created',
    'beforeMount',
    'mounted',
    'beforeDestroy',
    'destroyed',
    'beforeUpdate',
    'updated',
    'activated',
    'deactivated',
    'render',
    'errorCaptured', // 2.5
    'serverPrefetch' // 2.6
  ];
  return $internalHooks.includes(methodName);
}

function getMethods(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker
): MethodInfo[] | undefined {
  const result: MethodInfo[] = getClassAndObjectInfo(
    tsModule,
    defaultExportType,
    checker,
    getClassMethods,
    getObjectMethods
  );
  return result.length === 0 ? undefined : result;

  function getClassMethods(type: ts.Type) {
    const methodSymbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.MethodDeclaration) &&
          !getPropertyDecoratorNames(tsModule, property).some(decoratorName => decoratorName === 'Watch') &&
          !isInternalHook(property.name)
      );
    if (methodSymbols.length === 0) {
      return undefined;
    }

    return methodSymbols.map(method => {
      return {
        name: method.name,
        documentation: buildDocumentation(tsModule, method, checker)
      };
    });
  }

  function getObjectMethods(type: ts.Type) {
    const methodsSymbol = checker.getPropertyOfType(type, 'methods');
    if (!methodsSymbol || !methodsSymbol.valueDeclaration) {
      return undefined;
    }

    const methodsDeclaration = getLastChild(methodsSymbol.valueDeclaration);
    if (!methodsDeclaration) {
      return undefined;
    }

    if (methodsDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
      const methodsType = checker.getTypeOfSymbolAtLocation(methodsSymbol, methodsDeclaration);

      return checker.getPropertiesOfType(methodsType).map(s => {
        return {
          name: s.name,
          documentation: buildDocumentation(tsModule, s, checker)
        };
      });
    }
  }
}

function getNodeFromExportNode(tsModule: RuntimeLibrary['typescript'], exportExpr: ts.Node): ts.Node | undefined {
  switch (exportExpr.kind) {
    case tsModule.SyntaxKind.CallExpression:
      // Vue.extend or synthetic __vueEditorBridge
      return (exportExpr as ts.CallExpression).arguments[0];
    case tsModule.SyntaxKind.ObjectLiteralExpression:
      return exportExpr as ts.ObjectLiteralExpression;
    case tsModule.SyntaxKind.ClassDeclaration:
      return exportExpr as ts.ClassDeclaration;
  }
  return undefined;
}

export function getLastChild(d: ts.Declaration) {
  const children = d.getChildren();
  if (children.length === 0) {
    return undefined;
  }

  return children[children.length - 1];
}

export function isClassType(tsModule: RuntimeLibrary['typescript'], type: ts.Type) {
  if (type.isClass === undefined) {
    return !!(
      (type.flags & tsModule.TypeFlags.Object ? (type as ts.ObjectType).objectFlags : 0) & tsModule.ObjectFlags.Class
    );
  } else {
    return type.isClass();
  }
}

export function getClassDecoratorArgumentType(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportNode: ts.Type,
  checker: ts.TypeChecker
) {
  const decorators = getDecorators(tsModule, defaultExportNode.symbol.valueDeclaration as ts.PropertyDeclaration);
  if (!decorators || decorators.length === 0) {
    return undefined;
  }

  if (!tsModule.isCallExpression(decorators?.[0].expression)) {
    return undefined;
  }

  const decoratorArguments = decorators?.[0].expression?.arguments;
  if (!decoratorArguments || decoratorArguments.length === 0) {
    return undefined;
  }

  return checker.getTypeAtLocation(decoratorArguments[0]);
}

function getClassAndObjectInfo<C, O>(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker,
  getClassResult: (type: ts.Type) => C[] | undefined,
  getObjectResult: (type: ts.Type) => O[] | undefined,
  onlyUseObjectResultIfExists = false
) {
  const result: Array<C | O> = [];
  if (isClassType(tsModule, defaultExportType)) {
    const decoratorArgumentType = getClassDecoratorArgumentType(tsModule, defaultExportType, checker);
    if (decoratorArgumentType) {
      result.push.apply(result, getObjectResult(decoratorArgumentType) || []);
    }
    if (result.length === 0 || !onlyUseObjectResultIfExists) {
      result.push.apply(result, getClassResult(defaultExportType) || []);
    }
  } else {
    result.push.apply(result, getObjectResult(defaultExportType) || []);
  }
  return result;
}

function getNodeFromSymbol(property: ts.Symbol): ts.Declaration | undefined {
  return property.valueDeclaration ?? property.declarations?.[0];
}

function validPropertySyntaxKind(property: ts.Symbol, checkSyntaxKind: ts.SyntaxKind): boolean {
  return getNodeFromSymbol(property)?.kind === checkSyntaxKind;
}

function getPropertyDecoratorNames(tsModule: RuntimeLibrary['typescript'], property: ts.Symbol): string[] {
  const decorators = getDecorators(tsModule, getNodeFromSymbol(property) as ts.PropertyDeclaration);
  if (decorators === undefined) {
    return [];
  }

  return decorators
    .map(decorator => decorator.expression as ts.CallExpression)
    .filter(decoratorExpression => decoratorExpression.expression !== undefined)
    .map(decoratorExpression => decoratorExpression.expression.getText());
}

/**
 * Global type names that resolve inside the generated virtual template file
 * (`*.vue.template`). Local type aliases / interfaces declared in a component
 * (e.g. `ColorToken`, `Foo`) are *not* in scope there, so a prop type string that
 * references them would yield `Cannot find name` errors and must be rejected.
 */
const ALLOWED_GLOBAL_TYPE_IDENTIFIERS = new Set([
  'string',
  'number',
  'boolean',
  'any',
  'unknown',
  'never',
  'void',
  'undefined',
  'null',
  'object',
  'symbol',
  'bigint',
  'true',
  'false',
  'Array',
  'ReadonlyArray',
  'Date',
  'Function',
  'Object',
  'Promise',
  'Record',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'RegExp',
  'Error',
  'Symbol',
  'Partial',
  'Required',
  'Readonly',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable'
]);

/**
 * A type string is "self-contained" when every bare identifier it references is a global
 * type available in the virtual template file. String/number literals are ignored so a
 * union such as `"primary" | "secondary"` passes, while `ColorToken` or `Foo` does not.
 */
function isSelfContainedTypeString(typeString: string): boolean {
  const withoutStringLiterals = typeString
    .replace(/'(?:[^'\\]|\\.)*'/g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '')
    .replace(/`(?:[^`\\]|\\.)*`/g, '');
  const identifiers = withoutStringLiterals.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  return identifiers.every(id => ALLOWED_GLOBAL_TYPE_IDENTIFIERS.has(id));
}

/** Hard cap on an expanded structural type so a huge external interface falls back to `any`. */
const MAX_SELF_CONTAINED_TYPE_LENGTH = 800;

function getObjectFlags(tsModule: RuntimeLibrary['typescript'], type: ts.Type): ts.ObjectFlags {
  return type.flags & tsModule.TypeFlags.Object ? (type as ts.ObjectType).objectFlags : 0;
}

function isArrayLikeTypeReference(tsModule: RuntimeLibrary['typescript'], type: ts.Type): type is ts.TypeReference {
  return Boolean(
    getObjectFlags(tsModule, type) & tsModule.ObjectFlags.Reference &&
      type.symbol &&
      (type.symbol.name === 'Array' || type.symbol.name === 'ReadonlyArray')
  );
}

function isTupleTypeReference(tsModule: RuntimeLibrary['typescript'], type: ts.Type): type is ts.TypeReference {
  return Boolean(
    getObjectFlags(tsModule, type) & tsModule.ObjectFlags.Reference &&
      (type as ts.TypeReference).target.objectFlags & tsModule.ObjectFlags.Tuple
  );
}

function isValidIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/**
 * Return the list of string values when `type` is a string literal or a union of string
 * literals (`'primary' | 'secondary'` -> `['primary', 'secondary']`), otherwise `undefined`.
 * Used to offer static attribute value completions (`color="primary"`).
 */
export function getStringLiteralValues(
  tsModule: RuntimeLibrary['typescript'],
  type: ts.Type,
  checker: ts.TypeChecker
): string[] | undefined {
  const nonNullableType = checker.getNonNullableType(type);
  const members = nonNullableType.isUnion() ? nonNullableType.types : [nonNullableType];
  const values: string[] = [];
  for (const member of members) {
    if (member.isStringLiteral()) {
      values.push(member.value);
    } else {
      return undefined;
    }
  }
  return values.length > 0 ? values : undefined;
}

/** Rebuild a single call signature as `(name: T, ...) => R`, expanding any custom types. */
function getCallSignatureString(
  tsModule: RuntimeLibrary['typescript'],
  signature: ts.Signature,
  enclosingDeclaration: ts.Node | undefined,
  checker: ts.TypeChecker,
  depth: number,
  seen: Set<ts.Type>
): string | undefined {
  const params: string[] = [];
  for (let i = 0; i < signature.parameters.length; i++) {
    const parameter = signature.parameters[i];
    const parameterDeclaration = parameter.valueDeclaration;
    let parameterType = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration ?? enclosingDeclaration!);
    const isRest = Boolean(
      parameterDeclaration && tsModule.isParameter(parameterDeclaration) && parameterDeclaration.dotDotDotToken
    );
    const isOptional = Boolean(
      parameterDeclaration &&
        tsModule.isParameter(parameterDeclaration) &&
        (parameterDeclaration.questionToken || parameterDeclaration.initializer)
    );
    if (isOptional && !isRest) {
      parameterType = checker.getNonNullableType(parameterType);
    }
    const serialized = getSelfContainedTypeString(
      tsModule,
      parameterType,
      enclosingDeclaration,
      checker,
      depth + 1,
      seen
    );
    if (serialized === undefined) {
      return undefined;
    }
    const name = isValidIdentifier(parameter.name) ? parameter.name : `arg${i}`;
    params.push(`${isRest ? '...' : ''}${name}${isOptional && !isRest ? '?' : ''}: ${serialized}`);
  }

  const returnType = getSelfContainedTypeString(
    tsModule,
    signature.getReturnType(),
    enclosingDeclaration,
    checker,
    depth + 1,
    seen
  );
  if (returnType === undefined) {
    return undefined;
  }

  return `(${params.join(', ')}) => ${returnType}`;
}

/**
 * Serialize a TypeScript type into a *self-contained* type string usable in the generated
 * virtual template file, so custom types declared in a child component are still type-checked
 * when the prop is used in a parent template. Handles:
 *  - type aliases / literal unions (`ColorToken` -> `"primary" | "secondary"`),
 *  - arrays and tuples (`ColorToken[]` -> `("primary" | "secondary")[]`),
 *  - unions & intersections,
 *  - callbacks (`(v: ColorToken) => void`),
 *  - interfaces / object types, expanded structurally (`Badge` -> `{ id: number; ... }`).
 *
 * Returns `undefined` when the type cannot be expressed without referencing a local name
 * (recursive types, enums, exotic/huge types, ...), so callers can safely fall back to a
 * looser type rather than emitting an unresolvable identifier.
 */
export function getSelfContainedTypeString(
  tsModule: RuntimeLibrary['typescript'],
  type: ts.Type,
  enclosingDeclaration: ts.Node | undefined,
  checker: ts.TypeChecker,
  depth = 0,
  seen: Set<ts.Type> = new Set()
): string | undefined {
  if (depth > 6) {
    return undefined;
  }

  // Only the top-level prop's "not required" state is modeled separately (via `?`), so drop
  // null/undefined there to keep the value type clean (`color?: ColorToken` -> `ColorToken`).
  const currentType = depth === 0 ? checker.getNonNullableType(type) : type;

  // `ColorToken[]` -> `("primary" | "secondary")[]`
  if (isArrayLikeTypeReference(tsModule, currentType)) {
    const [element] = checker.getTypeArguments(currentType);
    if (element) {
      const serialized = getSelfContainedTypeString(tsModule, element, enclosingDeclaration, checker, depth + 1, seen);
      if (serialized === undefined) {
        return undefined;
      }
      return `${/[|&]/.test(serialized) ? `(${serialized})` : serialized}[]`;
    }
  }

  // `[A, B]` -> serialize each element.
  if (isTupleTypeReference(tsModule, currentType)) {
    const elements = checker
      .getTypeArguments(currentType)
      .map(element => getSelfContainedTypeString(tsModule, element, enclosingDeclaration, checker, depth + 1, seen));
    return elements.every((element): element is string => element !== undefined)
      ? `[${elements.join(', ')}]`
      : undefined;
  }

  // `InTypeAlias` expands a top-level alias while keeping primitives such as `boolean` intact
  // (instead of `true | false`). Primitives, literal unions, well-known globals and already
  // self-contained function types are taken verbatim; object literals (printed with `{ ... }`)
  // are always rebuilt structurally below so their member types are checked too.
  const typeString = checker.typeToString(
    currentType,
    enclosingDeclaration,
    tsModule.TypeFormatFlags.InTypeAlias | tsModule.TypeFormatFlags.NoTruncation
  );
  if (typeString === 'any' || typeString === 'unknown' || typeString === 'never') {
    return undefined;
  }
  if (!typeString.includes('{') && isSelfContainedTypeString(typeString)) {
    return typeString;
  }

  // `ColorToken | number` / intersections: expand each member so resolvable parts survive.
  if (currentType.isUnion()) {
    const parts = currentType.types.map(member =>
      getSelfContainedTypeString(tsModule, member, enclosingDeclaration, checker, depth + 1, seen)
    );
    return parts.every((part): part is string => part !== undefined) ? parts.join(' | ') : undefined;
  }
  if (currentType.isIntersection()) {
    const parts = currentType.types.map(member =>
      getSelfContainedTypeString(tsModule, member, enclosingDeclaration, checker, depth + 1, seen)
    );
    return parts.every((part): part is string => part !== undefined) ? parts.join(' & ') : undefined;
  }

  const callSignatures = checker.getSignaturesOfType(currentType, tsModule.SignatureKind.Call);
  const constructSignatures = checker.getSignaturesOfType(currentType, tsModule.SignatureKind.Construct);
  const properties = checker.getPropertiesOfType(currentType);

  // A plain callback type (single call signature, no own properties).
  if (callSignatures.length === 1 && constructSignatures.length === 0 && properties.length === 0) {
    return getCallSignatureString(tsModule, callSignatures[0], enclosingDeclaration, checker, depth, seen);
  }
  // Overloaded / constructible / callable-with-members types: only keep if already resolvable.
  if (callSignatures.length > 0 || constructSignatures.length > 0) {
    return isSelfContainedTypeString(typeString) ? typeString : undefined;
  }

  // Interface / object type -> expand to a structural literal `{ key: T; ... }` so a named
  // interface (`@Prop() foo!: Badge`) is type-checked in parent templates.
  if (getObjectFlags(tsModule, currentType)) {
    if (seen.has(currentType)) {
      return undefined; // recursive type, cannot be inlined
    }
    seen.add(currentType);
    try {
      const members: string[] = [];

      for (const property of properties) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? enclosingDeclaration;
        let propertyType = checker.getTypeOfSymbolAtLocation(property, declaration ?? enclosingDeclaration!);
        const optional = Boolean(property.flags & tsModule.SymbolFlags.Optional);
        if (optional) {
          propertyType = checker.getNonNullableType(propertyType);
        }
        const serialized = getSelfContainedTypeString(
          tsModule,
          propertyType,
          enclosingDeclaration,
          checker,
          depth + 1,
          seen
        );
        if (serialized === undefined) {
          return undefined;
        }
        const key = isValidIdentifier(property.name) ? property.name : JSON.stringify(property.name);
        members.push(`${key}${optional ? '?' : ''}: ${serialized}`);
      }

      for (const indexKind of [tsModule.IndexKind.String, tsModule.IndexKind.Number]) {
        const indexInfo = checker.getIndexInfoOfType(currentType, indexKind);
        if (indexInfo) {
          const serialized = getSelfContainedTypeString(
            tsModule,
            indexInfo.type,
            enclosingDeclaration,
            checker,
            depth + 1,
            seen
          );
          if (serialized === undefined) {
            return undefined;
          }
          members.push(`[key: ${indexKind === tsModule.IndexKind.String ? 'string' : 'number'}]: ${serialized}`);
        }
      }

      if (members.length === 0) {
        return undefined;
      }
      const result = `{ ${members.join('; ')} }`;
      return result.length > MAX_SELF_CONTAINED_TYPE_LENGTH ? undefined : result;
    } finally {
      seen.delete(currentType);
    }
  }

  return undefined;
}

export function buildDocumentation(tsModule: RuntimeLibrary['typescript'], s: ts.Symbol, checker: ts.TypeChecker) {
  let documentation = s
    .getDocumentationComment(checker)
    .map(d => d.text)
    .join('\n');

  documentation += '\n';

  const node = getNodeFromSymbol(s);
  if (node) {
    documentation += `\`\`\`js\n${formatJSLikeDocumentation(node.getText())}\n\`\`\`\n`;
  }

  return documentation;
}

function formatJSLikeDocumentation(src: string): string {
  const segments = src.split('\n');
  if (segments.length === 1) {
    return src;
  }

  const spacesToDeindent = segments[segments.length - 1].search(/\S/);

  return (
    segments[0] +
    '\n' +
    segments
      .slice(1)
      .map(s => s.slice(spacesToDeindent))
      .join('\n')
  );
}
