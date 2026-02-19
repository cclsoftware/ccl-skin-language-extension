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
// Filename    : server/src/variableresolver.ts
// Description : Variable Resolver
//
//************************************************************************************************

import { Element } from "domhandler";
import { SkinDefinitionParser } from "./skindefinitionparser";
import { ClassModelManager } from "./classmodelmanager";

export type DefineInfo = { name: string, values: { value: string, location: { url: string, start: number, end: number } }[] };
export type VariableSubstitution = { postfix: string, value: string, location: { url: string, start: number, end: number } };
export const kThemePrefix = "Theme";

//************************************************************************************************
// VariableResolver
//************************************************************************************************

export class VariableResolver
{
	public static resolveVariable (url: string, element: Element, variable: string): string[]
	{
		if(variable.indexOf ("$") == -1)
			return [variable];

		let result = new VariableResolutionResult ();
		this.resolveVariableInternal (result, url, element, variable);

		let resolve = (result: VariableResolutionResult) =>
		{
			let anythingResolved = false;
			let resolvedKeys = result.getResolvedKeys ();
			for(let resolvedIndex = 0; resolvedIndex < resolvedKeys.length; resolvedIndex++)
			{
				let resolvedVar = resolvedKeys[resolvedIndex];
				let matrix = result.getResolutionsForKey (resolvedVar);
				if(matrix == null)
					continue;

				for(let row = 0; row < matrix.length; row++)
				{
					for(let i = 0; i < matrix[row].length; i++)
					{
						let entry = matrix[row][i];
						if(!entry.isConcrete)
						{
							let currentVariable = entry.value;
							let resolutionResult = new VariableResolutionResult ();
							if(this.resolveVariableInternal (resolutionResult, url, element, currentVariable))
							{
								for(let t = 0; t < resolutionResult.resultTokens.length; t++)
								{
									let token = resolutionResult.resultTokens[t];
									if(!token.isConcrete && result.getResolutionsForKey (token.value) == null)
										anythingResolved = true;
								}

								result.integrateResultForToken (currentVariable, resolutionResult);
							}
						}
					}
				}
			}

			return anythingResolved;
		};

		while(resolve (result));

		return result.toStrings ();
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static resolveVariableInternal (result: VariableResolutionResult, url: string, element: Element, variable: string): boolean
	{
		if(variable.indexOf ("$") == -1)
			return false;

		let isEveryPartResolved = true;
		let tempResult = new VariableResolutionResult ();
		let staticPart = variable.substring (0, variable.indexOf ("$"));
		let variableParts = variable.substring (staticPart.length + 1).split ("$");

		if(staticPart.length > 0)
			result.resultTokens.push ({ value: staticPart, isConcrete: true });

		for(let i = 0; i < variableParts.length; i++)
		{
			let part = variableParts[i];
			if(part != "$")
			{
				let partResults = this.resolveVariablePart (url, element, part);
				if(partResults.length == 0)
				{
					result.resultTokens.push ({ value: "$" + part, isConcrete: true }); // an unresolvable variable is treated as a concrete value
					isEveryPartResolved = false;
				}
				else
				{
					for(let partResultIndex = 0; partResultIndex < partResults.length; partResultIndex++)
					{
						let postfix = partResults[partResultIndex].postfix;
						let variable = "$" + part.substring (0, part.length - postfix.length);
						if(partResultIndex == 0)
						{
							result.resultTokens.push ({ value: variable, isConcrete: false });
							if(postfix.length > 0)
								result.resultTokens.push ({ value: postfix, isConcrete: true });
						}

						let resolutions = tempResult.getResolutionsForKey (variable);
						if(resolutions == null)
							resolutions = [];

						let newResolution = partResults[partResultIndex].value;
						resolutions.push ([{ value: newResolution, isConcrete: newResolution.indexOf ("$") == -1 }]);
						tempResult.setResolutionsForKey (variable, resolutions);
					}
				}
			}
		}

		result.takeResolutions (tempResult);
		return isEveryPartResolved;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getVariablesInScope (url: string, element: Element, value: string): string[]
	{
		if(value.lastIndexOf ("$") == -1)
			return [];

		let variable = value.substring (value.lastIndexOf ("$") + 1);
		let result: string[] = [];
		this.getDefines (url, element, (infos: DefineInfo[]) =>
		{
			for(let i = 0; i < infos.length; i++)
			{
				let info = infos[i];
				if(info.name.toLowerCase ().startsWith (variable.toLowerCase ()) && result.indexOf (info.name) == -1)
					result.push (info.name);
			}

			return false;
		});

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static resolveVariablePart (url: string, element: Element, variable: string): { value: string, postfix: string }[]
	{
		let result: { value: string, postfix: string }[] = [];
		if(variable.startsWith (kThemePrefix + "."))
		{
			let prefixLength = kThemePrefix.length + 1;
			let metricName = variable.substring (prefixLength);
			let themeMetrics = ClassModelManager.getThemeMetrics ();
			let longestName = 0;
			let resultIndex = -1;
			for(let i = 0; i < themeMetrics.length; i++)
			{
				let name = themeMetrics[i].name;
				if(name.length > longestName && metricName.startsWith (name))
				{
					longestName = name.length;
					resultIndex = i;
				}
			}

			if(resultIndex > -1)
			{
				result.push ({ value: themeMetrics[resultIndex].value + "", postfix: variable.substring (prefixLength + longestName) });
				return result;
			}
		}

		let substitutions = this.findMatchingVariableSubstitutions (url, element, variable).substitutions;
		for(let valueIndex = 0; valueIndex < substitutions.length; valueIndex++)
		{
			let variableStart = substitutions[valueIndex].value.indexOf ("$");
			if(variableStart > -1 && variable.startsWith (substitutions[valueIndex].value.substring (variableStart + 1)))
				continue; // don't resolve to a prefix of the variable

			let value = substitutions[valueIndex].value;
			let postfix = substitutions[valueIndex].postfix;
			let found = false;
			for(let i = 0; i < result.length; i++)
			{
				if(result[i].value == value && result[i].postfix == postfix)
				{
					found = true;
					break;
				}
			}

			if(!found)
				result.push ({ value: value, postfix: postfix });
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findMatchingVariableSubstitutions (url: string, element: Element, variable: string)
		: { substitutions: VariableSubstitution[], variableDefinedForAllPaths: boolean }
	{
		let result: { substitutions: VariableSubstitution[], variableDefinedForAllPaths: boolean } = { substitutions: [], variableDefinedForAllPaths: true };
		let minPostfixLength = -1;
		this.getDefines (url, element, (infos: DefineInfo[]) =>
		{
			let currentMinPostfixLength = -1;
			let found = false;
			for(let i = 0; i < infos.length; i++)
			{
				let info = infos[i];
				if(variable.startsWith (info.name))
				{
					found = true;
					let postfix = variable.substring (info.name.length);
					if(currentMinPostfixLength == -1 || currentMinPostfixLength > postfix.length)
						currentMinPostfixLength = postfix.length;

					for(let v = 0; v < info.values.length; v++)
						result.substitutions.push ({ postfix: postfix, value: info.values[v].value, location: info.values[v].location });
				}
			}

			if(!found)
				result.variableDefinedForAllPaths = false;

			if(minPostfixLength == -1 || (currentMinPostfixLength >= 0 && minPostfixLength > currentMinPostfixLength))
				minPostfixLength = currentMinPostfixLength;

			return currentMinPostfixLength == 0;
		});

		for(let i = 0; i < result.substitutions.length; i++)
		{
			if(result.substitutions[i].postfix.length > minPostfixLength)
			{
				result.substitutions.splice (i, 1);
				i--;
			}
		}

		if(result.substitutions.length == 0)
			result.variableDefinedForAllPaths = false;

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getDefines (url: string, element: Element, resultFunction: (infos: DefineInfo[]) => boolean,
							   elementsSeen: Set<string> = new Set): void
	{
		if(element.startIndex == null)
			return;

		let elementId = url + ":" + element.startIndex;
		if(elementsSeen.has (elementId))
			return;

		elementsSeen.add (elementId);

		let resolves: DefineInfo[] = [];
		let formName = this.findFormName (url, element, resolves);
		if(resolves.length > 0)
		{
			resolves.sort ((a, b) => b.name.length - a.name.length); // sort longest names to the top
			if(resultFunction (resolves))
				return;
		}

		let parentFound = false;
		if(formName.length > 0)
		{
			SkinDefinitionParser.forEachFileInScope (url, 0, undefined, (_, info) =>
			{
				// get the forms in which formName is instantiated (e.g. <Form name="parent"><View name="formName"/></Form>)
				let parents = info.getViewParents (formName);
				if(parents.length == 0)
					parents = info.getViewParents (SkinDefinitionParser.qualifyName (url, formName));

				for(let i = 0; i < parents.length; i++)
				{
					for(let e = 0; e < parents[i].instantiations.length; e++)
					{
						parentFound = true;
						this.getDefines (info.getURI (), parents[i].instantiations[e], resultFunction, elementsSeen);
					}
				}

				return false;
			});
		}

		if(!parentFound)
			resultFunction ([]);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findFormName (url: string, element: Element, defines: DefineInfo[]): string
	{
		let skinFile = SkinDefinitionParser.getSkinFile (url);
		if(skinFile == null || element == null || element.startIndex == null)
			return "";

		if(element.tagName == "Form")
		{
			let result = element.attribs["name"];
			if(result == null)
				return "";

			return result;
		}
		else if(element.tagName == "define")
		{
			let attributes = element.attribs;
			SkinDefinitionParser.putExpressionInParentheses (attributes);
			let text = skinFile.getDocumentText ();
			for(let a in element.attribs)
			{
				let startIndex = text.indexOf (a, element.startIndex);
				let newDef = {
					value: element.attribs[a],
					location: {
						url: url,
						start: startIndex,
						end: startIndex + a.length
					}
				};

				let def = defines.find (info => info.name == a);
				if(def == null)
				{
					def = { name: a, values: [newDef] };
					defines.push (def);
				}
			}
		}
		else if(element.tagName == "foreach")
		{
			let result = this.extractForeach (element, true);
			if(result != null)
			{
				let text = skinFile.getDocumentText ();
				let startIndex = text.indexOf ("$" + result.variable, element.startIndex) + 1;
				let def = defines.find (info => result != null && info.name == result.variable);
				if(def == null)
				{
					def = { name: result.variable, values: [] };
					defines.push (def);

					for(let i = 0; i < result.values.length; i++)
					{
						def.values.push ({
							value: result.values[i],
							location: {
								url: url,
								start: startIndex,
								end: startIndex + result.variable.length
							}
						});
					}
				}
			}
		}
		else if(element.tagName == "styleselector")
		{
			let name = element.attribs["variable"];
			let valueString = element.attribs["styles"];
			if(name != null && name.startsWith ("$") && valueString != null)
			{
				name = name.substring (1); // remove $
				let def = defines.find (info => info.name == name);
				if(def == null)
				{
					def = { name: name, values: [] };
					defines.push (def);
				}

				let values = valueString.trim ().split (" ");
				let text = skinFile.getDocumentText ();
				let stylesIndex = text.indexOf (" styles", element.startIndex);
				for(let a = 0; a < values.length; a++)
				{
					let val = values[a];
					let startIndex = text.indexOf (val, stylesIndex);
					def.values.push ({
						value: SkinDefinitionParser.qualifyName (url, val),
						location: {
							url: url,
							start: startIndex,
							end: startIndex + val.length
						}
					});
				}
			}
		}

		return this.findFormName (url, <Element>element.parentNode, defines);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static extractForeach (element: Element, unrollLoop: boolean)
	{
		if(element.tagName == "foreach")
		{
			let variable = element.attribs["variable"];
			if(variable != null)
			{
				if(variable.startsWith ("$"))
					variable = variable.substring (1);

				let values: string[] = [];
				if(element.attribs["in"] != null)
				{
					values = element.attribs["in"].split (/[,\s+]/);
					
					if(!unrollLoop)
						values = ["@foreach:([" + values.join (",") + "])"];
				}
				else
				{
					let start = element.attribs["start"];
					if(start == null)
						start = "0";

					let count = element.attribs["count"];
					if(count != null)
					{
						if(unrollLoop && SkinDefinitionParser.isNumeric (start) && SkinDefinitionParser.isNumeric (count) && +count <= 100)
						{
							for(let i = 0; i < +count; i++)
								values.push ("" + (+start + i));
						}
						else
							values.push ("@foreach:(" + start + "," + count + ")");
					}
				}

				return { variable: variable, values: values };
			}
		}

		return null;
	}
}

//************************************************************************************************
// VariableResolutionResult
//************************************************************************************************

type VariableResultToken = { value: string, isConcrete: boolean };
type VariableResolutionGraph = { [id: string]: VariableResultToken[][] | undefined };

//////////////////////////////////////////////////////////////////////////////////////////////////

class VariableResolutionResult
{
	public resultTokens: VariableResultToken[] = [];

	private variableResolutions: VariableResolutionGraph[] = [{}];
	private replacedDependencies: string[] = [];

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getResolvedKeys (): string[]
	{
		return Object.keys (this.variableResolutions[0]);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getResolutionsForKey (key: string)
	{
		return this.variableResolutions[0][key];
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public setResolutionsForKey (key: string, resolutions: VariableResultToken[][])
	{
		this.variableResolutions[0][key] = resolutions;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public takeResolutions (result: VariableResolutionResult)
	{
		this.variableResolutions = result.variableResolutions;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private getDependencies (value: string, resolutions: VariableResolutionGraph)
	{
		let result: string[] = [];
		let resolution = resolutions[value];
		if(resolution == null)
			return result;

		for(let row = 0; row < resolution.length; row++)
		{
			for(let col = 0; col < resolution[row].length; col++)
			{
				let res = resolution[row][col];
				if(!res.isConcrete)
				{
					let value = res.value;
					if(resolutions[value] == null)
						res.isConcrete = true;
					else if(result.indexOf (value) == -1)
						result.push (value);
				}
			}
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public integrateResultForToken (token: string, result: VariableResolutionResult)
	{
		if(result.variableResolutions.length != 1)
			throw new Error ("Cannot integrate a result with more than one graph.");

		for(let resolutionIndex = 0; resolutionIndex < this.variableResolutions.length; resolutionIndex++)
		{
			for(let r in result.variableResolutions[0])
			{
				if(this.variableResolutions[resolutionIndex][r] == null)
					this.variableResolutions[resolutionIndex][r] = result.variableResolutions[0][r];
			}

			let offset = 0;
			let numTokens = this.resultTokens.length;
			for(let i = 0; i < numTokens; i++)
			{
				if(this.resultTokens[i + offset].value == token)
				{
					offset += result.resultTokens.length - 1;
					this.resultTokens.splice (i + offset, 1, ...result.resultTokens);
				}
			}

			for(let r in this.variableResolutions[resolutionIndex])
			{
				let res = this.variableResolutions[resolutionIndex][r];
				if(res == null)
					continue;

				for(let row = 0; row < res.length; row++)
				{
					let offset = 0;
					let numCols = res[row].length;
					for(let col = 0; col < numCols; col++)
					{
						let entry = res[row][col + offset];
						if(entry.value == token)
						{
							res[row].splice (col + offset, 1, ...result.resultTokens);
							offset += result.resultTokens.length - 1;
						}
					}
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private replaceDependency (dependency: string)
	{
		if(this.replacedDependencies.indexOf (dependency) > -1)
			return;

		this.replacedDependencies.push (dependency);

		let resolutionOffset = 0;
		let numResolutions = this.variableResolutions.length;
		for(let resolutionIndex = 0; resolutionIndex < numResolutions; resolutionIndex++)
		{
			let dependencies = this.getDependencies (dependency, this.variableResolutions[resolutionIndex + resolutionOffset]);
			for(let d = 0; d < dependencies.length; d++)
			{
				this.replaceDependency (dependencies[d]);
				delete this.variableResolutions[resolutionIndex + resolutionOffset][dependencies[d]];
				numResolutions = this.variableResolutions.length;
			}

			let res = this.variableResolutions[resolutionIndex + resolutionOffset][dependency];
			if(res == null || res.length == 0)
				return;

			let numResults = res.length;
			if(numResults > 1)
				this.cloneResolutionAt (resolutionIndex + resolutionOffset, numResults - 1);

			for(let r in this.variableResolutions[resolutionIndex + resolutionOffset])
			{
				if(r == dependency)
					continue;

				for(let resultIndex = 0; resultIndex < numResults; resultIndex++)
				{
					let currentRes = this.variableResolutions[resolutionIndex + resolutionOffset + resultIndex][r];
					if(currentRes == null)
						continue;

					let numRows = currentRes.length;
					for(let row = 0; row < numRows; row++)
					{
						let numCols = currentRes[row].length;
						let colOffset = 0;
						for(let col = 0; col < numCols; col++)
						{
							let entry = currentRes[row][col + colOffset];
							if(!entry.isConcrete && entry.value == dependency)
							{
								currentRes[row].splice (col + colOffset, 1, ...res[resultIndex]);
								colOffset += res[resultIndex].length - 1;
							}
						}
					}
				}
			}

			resolutionOffset += numResults - 1;
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private cloneResolutionAt (index: number, times: number)
	{
		let res = this.variableResolutions[index];
		for(let i = 0; i < times; i++)
		{
			this.variableResolutions.splice (index + 1, 0, {});
			for(let variable in res)
			{
				let matrix = res[variable];
				if(matrix == null)
					continue;

				let newRes: VariableResultToken[][] = [];
				for(let row = 0; row < matrix.length; row++)
				{
					newRes.push ([]);
					for(let col = 0; col < matrix[row].length; col++)
						newRes[row].push ({ value: matrix[row][col].value, isConcrete: matrix[row][col].isConcrete });
				}

				this.variableResolutions[index + 1][variable] = newRes;
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public process ()
	{
		if(this.variableResolutions.length != 1)
			return; // already processed

		if(this.resultTokens.length > 1)
		{
			this.variableResolutions[0]["$__init"] = [this.resultTokens];
			this.resultTokens = [{ value: "$__init", isConcrete: false }];
		}

		if(!this.resultTokens[0].isConcrete)
			this.replaceDependency (this.resultTokens[0].value);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public toStrings ()
	{
		let result: string[] = [];
		if(this.resultTokens.length == 0)
			return result;

		this.process ();

		let token = this.resultTokens[0];
		let resultString = token.value;
		if(token.isConcrete)
			result.push (token.value);
		else
		{
			for(let resolutionIndex = 0; resolutionIndex < this.variableResolutions.length; resolutionIndex++)
			{
				let res = this.variableResolutions[resolutionIndex][token.value];
				if(res != null)
				{
					for(let row = 0; row < res.length; row++)
					{
						resultString = "";
						for(let col = 0; col < res[row].length; col++)
							resultString += res[row][col].value;

						if(result.indexOf (resultString) == -1)
							result.push (resultString);
					}
				}
			}

			if(result.length == 0)
				result.push (token.value); // cannot resolve
		}

		return result;
	}
}
