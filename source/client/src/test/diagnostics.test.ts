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
// Filename    : client/src/test/diagnostics.test.ts
// Description : Diagnostics Test
//
//************************************************************************************************

import * as vscode from 'vscode';
import * as assert from 'assert';
import { getDocUri, activate } from './helper';

suite('Diagnostics', () =>
{
	const docUri = getDocUri ('MySkinPack/skin.xml');
	test ('Style diagnostics', async () =>
	{
		const kErrorSource = "CCL Skin";
		await testDiagnostics (docUri,
		[
			{
				message: 'color has no value. Consider removing it.',
				range: createRange (10, 29, 10, 29),
				severity: vscode.DiagnosticSeverity.Warning,
				source: kErrorSource
			},
			{
				message: 'Element "Button" is not a valid child for "Skin".',
				range: createRange (14, 2, 14, 8),
				severity: vscode.DiagnosticSeverity.Error,
				source: kErrorSource
			},
			{
				message: 'No definition found for style "My.".',
				range: createRange (14, 16, 14, 19),
				severity: vscode.DiagnosticSeverity.Error,
				source: kErrorSource
			},
			{
				message: 'Element "Variant" is not a valid child for "Skin".',
				range: createRange (16, 2, 16, 9),
				severity: vscode.DiagnosticSeverity.Error,
				source: kErrorSource
			},
			{
				message: 'No closing tag found for <Variant>.',
				range: createRange (16, 2, 16, 9),
				severity: vscode.DiagnosticSeverity.Error,
				source: kErrorSource
			}
		]);
	});
});

//////////////////////////////////////////////////////////////////////////////////////////////////

function createRange (sLine: number, sChar: number, eLine: number, eChar: number)
{
	const start = new vscode.Position (sLine, sChar);
	const end = new vscode.Position (eLine, eChar);

	return new vscode.Range (start, end);
}

//////////////////////////////////////////////////////////////////////////////////////////////////

async function testDiagnostics (docUri: vscode.Uri, expectedDiagnostics: vscode.Diagnostic[])
{
	await activate (docUri);
	const actualDiagnostics = vscode.languages.getDiagnostics (docUri);
	assert.strictEqual (actualDiagnostics.length, expectedDiagnostics.length);

	expectedDiagnostics.forEach ((expectedDiagnostic, i) =>
	{
		const actualDiagnostic = actualDiagnostics[i];
		assert.strictEqual (actualDiagnostic.message, expectedDiagnostic.message);
		assert.deepStrictEqual (actualDiagnostic.range, expectedDiagnostic.range);
		assert.strictEqual (actualDiagnostic.severity, expectedDiagnostic.severity);
	});
}
