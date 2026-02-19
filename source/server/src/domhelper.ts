//************************************************************************************************
//
// CCL Skin Language Extension
//
// This file is part of Crystal Class Library (R)
// Copyright (c) 2025 CCL Software Licensing GmbH.
// All Rights Reserved.
//
// Licensed for use under either:
//  1. a Commercial License provided by CCL Software Licensing GmbH, or
//  2. GNU Affero General Public License v3.0 (AGPLv3).
// 
// You must choose and comply with one of the above licensing options.
// For more information, please visit ccl.dev.
//
// Filename    : server/src/domhelper.ts
// Description : DOM Helper
//
//************************************************************************************************

import { Document, Element, Node } from "domhandler";
import { ElementType } from "htmlparser2";

//************************************************************************************************
// DomHelper
//************************************************************************************************

export class DomHelper
{
	public static findFirstChild (parent: Document | Element | Node, name: string | string[], attributeName?: string, attributeValue?: string): Element | null
	{
		let result: Element[] = [];
		DomHelper.findChildrenInternal (result, true, -1, parent, name, attributeName, attributeValue);
		if(result.length > 0)
			return result[0];

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findChildren (parent: Document | Element | Node, name: string | string[], attributeName?: string, attributeValue?: string): Element[]
	{
		let result: Element[] = [];
		DomHelper.findChildrenInternal (result, false, -1, parent, name, attributeName, attributeValue);
		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findDirectChildren (parent: Document | Element | Node, name: string | string[], attributeName?: string, attributeValue?: string): Element[]
	{
		let result: Element[] = [];
		DomHelper.findChildrenInternal (result, false, 1, parent, name, attributeName, attributeValue);
		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findChildrenInternal (result: Element[], firstOnly: boolean, depth: number,
										 parent: Document | Element | Node, name: string | string[],
										 attributeName?: string, attributeValue?: string, firstIteration = true)
	{
		if(!firstIteration && "name" in parent && (typeof name === 'string' && parent.name == name || typeof name !== 'string' && name.indexOf (parent.name) > -1))
		{
			let attributeMatch = true;
			if(attributeName != null && attributeValue != null)
				attributeMatch = parent.attribs[attributeName] == attributeValue;

			if(attributeMatch)
			{
				result.push (parent);
				if(firstOnly)
					return;
			}
		}

		if(depth == 0) // -1 is infinite
			return;

		depth--;

		if("children" in parent)
		{
			for(let i = 0; i < parent.children.length; i++)
			{
				let child = parent.children[i];
				if(child.type == ElementType.Tag)
				{
					let elems: Element[] = [];
					this.findChildrenInternal (elems, firstOnly, depth, child, name, attributeName, attributeValue, false);
					for(let e = 0; e < elems.length; e++)
					{
						result.push (elems[e]);
						if(firstOnly)
							return;
					}
				}
			}
		}
	}
}
