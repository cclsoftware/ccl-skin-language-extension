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
// Filename    : client/src/test/runTest.ts
// Description : Test Main
//
//************************************************************************************************

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

//////////////////////////////////////////////////////////////////////////////////////////////////

async function main ()
{
	try
	{
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve (__dirname, '../../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve (__dirname, './index');

		// Download VS Code, unzip it and run the integration test
		await runTests ({ extensionDevelopmentPath, extensionTestsPath });
	}
	catch(err)
	{
		console.error ('Failed to run tests');
		process.exit (1);
	}
}

main ();
