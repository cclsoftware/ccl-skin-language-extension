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
// Filename    : server/src/skinexpressionparser.ts
// Description : Skin Expression Parser
//
//************************************************************************************************

// adapted from ccl/gui/skin/skinexpression.cpp

enum OperatorType
{
	kError,
	kAnd,
	kOr,
	kLess,
	kLessOrEqual,
	kGreater,
	kGreaterOrEqual,
	kEqual,
	kMultiply,
	kDivide,
	kModulo
}

//************************************************************************************************
// DivideHelper
//************************************************************************************************

class DivideHelper
{
	public static divide (v1: number, v2: number)
	{
		if(v2 == 0)
			throw new Error ("Cannot divide by 0.");

		return v1 / v2;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static modulo (v1: number, v2: number)
	{
		if(v2 == 0)
			throw new Error ("Cannot modulo by 0.");

		return v1 % v2;
	}
}

//************************************************************************************************
// SkinExpressionParser
//************************************************************************************************

export class SkinExpressionParser
{
	private static numberRegex = "^-?\\d+(?:\\.\\d+)?";
	private error: string | null = null;

	constructor (private expression: string) {}

	public static evaluate (expression: string): { value: number | string | boolean | null, error: string | null }
	{
		if(expression.indexOf ("$") > -1)
			return { value: expression, error: "Cannot evaluate unresolved variable." };

		let parser = new SkinExpressionParser (expression);
		return { value: parser.readExpression (), error: parser.error };
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private read (character: string): boolean
	{
		if(this.expression.startsWith (character))
		{
			this.expression = this.expression.substring (character.length);
			return true;
		}

		return false;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private peek (): string
	{
		if(this.expression.length == 0)
			return "";

		return this.expression[0];
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readNumber (): number | null
	{
		let value = this.expression.match (SkinExpressionParser.numberRegex);
		if(value != null && value.length > 0)
		{
			this.expression = this.expression.substring (value[0].length);
			return +value[0];
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readStringLiteral (quoteCharacter: string): string | null
	{
		if(!this.expression.startsWith (quoteCharacter))
			return null;

		let i = 1
		for(; i < this.expression.length; i++)
		{
			if(this.expression[i] == quoteCharacter)
				break;
		}

		return this.expression.substring (1, i);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private skipWhite ()
	{
		this.expression = this.expression.trim ();
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readExpression (): number | string | boolean | null
	{
		let result = this.readBoolExpression ();
		if(this.expression.length > 0)
			result = (result != null ? result : "") + this.expression;

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readBoolOperator (): OperatorType
	{
		if(this.read ('&'))
			return OperatorType.kAnd;
		else if(this.read ('|'))
			return OperatorType.kOr;
		else
			return OperatorType.kError;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readBoolExpression (): number | string | boolean | null
	{
		let v1 = this.readRelation ();
		if(v1 == null)
			return null;

		this.skipWhite ();
		let op = this.readBoolOperator ();
		while(op != OperatorType.kError)
		{
			let v2 = this.readRelation ();
			if(v2 == null)
				return null;

			switch(op)
			{
			case OperatorType.kAnd:
				v1 = v1 && v2;
				break;

			case OperatorType.kOr:
				v1 = v1 || v2;
				break;
			}
			this.skipWhite ();
		}

		return v1;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readRelationalOperator (): OperatorType
	{
		if(this.read ('<'))
			return this.read ('=') ? OperatorType.kLessOrEqual : OperatorType.kLess;
		else if(this.read ('>'))
			return this.read ('=') ? OperatorType.kGreaterOrEqual : OperatorType.kGreater;
		else if(this.read ('='))
			return OperatorType.kEqual;
		else
			return OperatorType.kError;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readRelation (): number | string | boolean | null
	{
		let v1: number | string | boolean | null = this.readSum ();
		if(v1 == null)
			return null;

		this.skipWhite ();
		let op = this.readRelationalOperator ();
		while(op != OperatorType.kError)
		{
			let v2 = this.readSum ();
			if(v2 == null)
				return null;

			let result = false;
			switch(op)
			{
			case OperatorType.kLess:
				result = v1 < v2;
				break;
			case OperatorType.kLessOrEqual:
				result = v1 < v2 || v1 == v2;
				break;
			case OperatorType.kGreater:
				result = v1 > v2;
				break;
			case OperatorType.kGreaterOrEqual:
				result = v1 > v2 || v1 == v2;
				break;
			case OperatorType.kEqual:
				result = v1 == v2;
				break;
			}
			v1 = result;

			this.skipWhite ();
			op = this.readRelationalOperator ();
		}

		return v1;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readSum (): number | string | boolean | null
	{
		let v1 = this.readProduct ();
		if(v1 == null)
			return null;

		this.skipWhite ();
		let plus = this.read ('+');
		while(plus || this.read ('-'))
		{
			let v2 = this.readProduct ();
			if(v2 == null)
				return null;

			if(typeof v1 === "string")
				v1 = +v1;
			if(typeof v2 === "string")
				v2 = +v2;

			if(typeof v1 === "boolean" || typeof v2 === "boolean")
			{
				this.error = "Cannot add or subtract boolean values.";
				return null;
			}

			let sign = plus ? 1 : -1;
			v1 = v1 + sign * v2;

			this.skipWhite ();
			plus = this.read ('+');
		}

		return v1;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readProductOperator (): OperatorType
	{
		if(this.read ('*'))
			return OperatorType.kMultiply;
		else if(this.read ('/'))
			return OperatorType.kDivide;
		else if(this.read ('%'))
			return OperatorType.kModulo;
		else
			return OperatorType.kError;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readProduct (): number | string | boolean | null
	{
		let v1 = this.readFactor ();
		if(v1 == null)
			return null;

		this.skipWhite ();
		let op = this.readProductOperator ();
		while(op != OperatorType.kError)
		{
			let v2 = this.readFactor ();
			if(v2 == null)
				return null;

			if(typeof v1 === "string")
				v1 = +v1;
			if(typeof v2 === "string")
				v2 = +v2;

			if(typeof v1 === "boolean" || typeof v2 === "boolean")
			{
				this.error = "Cannot multiply or divide boolean values.";
				return null;
			}

			try
			{
				switch(op)
				{
				case OperatorType.kMultiply:
					v1 = v1 * v2;
					break;

				case OperatorType.kDivide:
					v1 = DivideHelper.divide (v1, v2);
					break;

				case OperatorType.kModulo:
					v1 = DivideHelper.modulo (v1, v2);
					break;
				}
			}
			catch (e: any)
			{
				this.error = (<Error>e).message;
				v1 = 0; // match the C++ implementation
			}

			this.skipWhite ();
			op = this.readProductOperator ();
		}

		return v1;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readFactor (): number | string | boolean | null
	{
		this.skipWhite ();

		if(this.read ('!'))
		{
			let v = this.readFactor ();
			if(v != null)
			{
				if(typeof v === "boolean")
					return !v;

				return v;
			}

			return null;
		}
		
		let v: number | string | boolean | null = this.readConstant ();
		if(v != null)
			return v;

		if(this.read ('('))
		{
			v = this.readExpression ();
			if(v == null)
				return null;

			this.skipWhite ();
			if(!this.read (')'))
				return null;

			return v;
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private readConstant (): number | string | null
	{
		let number = this.readNumber ();
		if(number != null)
			return number;
		else if(this.peek () == '\'')
			return this.readStringLiteral ('\'');

		return null;
	}
}
