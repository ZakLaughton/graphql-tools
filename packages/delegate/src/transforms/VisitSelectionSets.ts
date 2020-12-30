import {
  DocumentNode,
  GraphQLSchema,
  Kind,
  SelectionSetNode,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  GraphQLOutputType,
  OperationDefinitionNode,
  FragmentDefinitionNode,
  SelectionNode,
  DefinitionNode,
} from 'graphql';

import { Request } from '@graphql-tools/utils';

import { Transform, DelegationContext } from '../types';

export default class VisitSelectionSets implements Transform {
  private readonly visitor: (node: SelectionSetNode, typeInfo: TypeInfo) => SelectionSetNode;

  constructor(visitor: (node: SelectionSetNode, typeInfo: TypeInfo) => SelectionSetNode) {
    this.visitor = visitor;
  }

  public transformRequest(
    originalRequest: Request,
    delegationContext: DelegationContext,
    _transformationContext: Record<string, any>
  ): Request {
    const document = visitSelectionSets(
      originalRequest,
      delegationContext.info.schema,
      delegationContext.returnType,
      this.visitor
    );
    return {
      ...originalRequest,
      document,
    };
  }
}

function visitSelectionSets(
  request: Request,
  schema: GraphQLSchema,
  initialType: GraphQLOutputType,
  visitor: (node: SelectionSetNode, typeInfo: TypeInfo) => SelectionSetNode
): DocumentNode {
  const { document } = request;

  const operations: Array<OperationDefinitionNode> = [];
  const fragments: Record<string, FragmentDefinitionNode> = Object.create(null);
  document.definitions.forEach(def => {
    if (def.kind === Kind.OPERATION_DEFINITION) {
      operations.push(def);
    } else if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragments[def.name.value] = def;
    }
  });

  const typeInfo = new TypeInfo(schema, undefined, initialType);
  const newDefinitions: Array<DefinitionNode> = operations.map(operation => {
    const newSelections: Array<SelectionNode> = [];

    operation.selectionSet.selections.forEach(selection => {
      if (selection.kind === Kind.INLINE_FRAGMENT) {
        newSelections.push(
          visit(
            selection,
            visitWithTypeInfo(typeInfo, {
              [Kind.SELECTION_SET]: node => visitor(node, typeInfo),
            })
          )
        );
      } else if (selection.kind === Kind.FIELD) {
        const selectionSet = selection.selectionSet;

        if (selectionSet == null) {
          newSelections.push(selection);
          return;
        }

        const newSelectionSet = visit(
          selectionSet,
          visitWithTypeInfo(typeInfo, {
            [Kind.SELECTION_SET]: node => visitor(node, typeInfo),
          })
        );

        if (newSelectionSet === selectionSet) {
          newSelections.push(selection);
          return;
        }

        newSelections.push({
          ...selection,
          selectionSet: newSelectionSet,
        });
      }
    });

    return {
      ...operation,
      selectionSet: {
        kind: Kind.SELECTION_SET,
        selections: newSelections,
      },
    };
  });

  Object.values(fragments).forEach(fragment => {
    newDefinitions.push(
      visit(
        fragment,
        visitWithTypeInfo(typeInfo, {
          [Kind.SELECTION_SET]: node => visitor(node, typeInfo),
        })
      )
    );
  });

  return {
    ...document,
    definitions: newDefinitions,
  };
}
