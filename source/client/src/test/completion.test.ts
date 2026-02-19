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
// Filename    : client/src/test/completion.test.ts
// Description : Completion Test
//
//************************************************************************************************

import * as vscode from 'vscode';
import * as assert from 'assert';
import { getDocUri, activate } from './helper';

//////////////////////////////////////////////////////////////////////////////////////////////////

suite ('Completion', () =>
{
	const docUri = getDocUri ('MySkinPack/skin.xml');
	test ('Complete second level', async () =>
	{
		await testCompletion (docUri, new vscode.Position (14, 19),
		{
			items: [
				{ label: 'primary', kind: vscode.CompletionItemKind.Module },
				{ label: 'secondary', kind: vscode.CompletionItemKind.Module }
			]
		});
	});

	test ('Complete auto close opened tag', async () =>
	{
		await testPreselectedCompletion (docUri, new vscode.Position (18, 2),
		{
			label: '/Variant>',
			kind: vscode.CompletionItemKind.Snippet
		});
	});
});

//////////////////////////////////////////////////////////////////////////////////////////////////

async function testCompletion (docUri: vscode.Uri, position: vscode.Position,expectedCompletionList: vscode.CompletionList)
{
	await activate (docUri);

	// Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
	const actualCompletionList = (await vscode.commands.executeCommand (
		'vscode.executeCompletionItemProvider',
		docUri,
		position
	)) as vscode.CompletionList;

	assert.ok (actualCompletionList.items.length >= 1);
	expectedCompletionList.items.forEach ((expectedItem, i) =>
	{
		const actualItem = actualCompletionList.items[i];
		assert.strictEqual (actualItem.label, expectedItem.label);
		assert.strictEqual (actualItem.kind, expectedItem.kind);
	});
}

//////////////////////////////////////////////////////////////////////////////////////////////////

async function testPreselectedCompletion (docUri: vscode.Uri, position: vscode.Position, expectedCompletionItem: vscode.CompletionItem)
{
	await activate (docUri);

	// Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
	const actualCompletionList = (await vscode.commands.executeCommand (
		'vscode.executeCompletionItemProvider',
		docUri,
		position
	)) as vscode.CompletionList;

	assert.ok (actualCompletionList.items.length >= 1);
	for(let i = 0; i < actualCompletionList.items.length; i++)
	{
		let actualItem = actualCompletionList.items[i];
		if(actualItem.preselect === true)
		{
			assert.strictEqual (actualItem.label, expectedCompletionItem.label);
			assert.strictEqual (actualItem.kind, expectedCompletionItem.kind);

			return;
		}
	}

	assert.strictEqual (actualCompletionList.items[0].label, expectedCompletionItem.label);
	assert.strictEqual (actualCompletionList.items[0].kind, expectedCompletionItem.kind);
}
