/**
 * AST Parsing Demo — C#
 *
 * Demonstrates tree-sitter-c-sharp integration with the Docuvia language registry.
 * Parses a sample C# file and extracts imports, classes, functions, and calls.
 */

import { Parser, Language } from 'web-tree-sitter';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LanguageRegistry } from '@workspace/ast-core';

const require = createRequire(import.meta.url);

async function main() {
  // Locate web-tree-sitter.wasm
  const tsWasmPath = path.join(
    path.dirname(require.resolve('web-tree-sitter')),
    'web-tree-sitter.wasm',
  );

  await Parser.init({ locateFile: () => tsWasmPath });

  // Locate tree-sitter-c_sharp.wasm
  const csharpWasmPath = path.join(
    path.dirname(require.resolve('tree-sitter-c-sharp/package.json')),
    'tree-sitter-c_sharp.wasm',
  );

  // Load C# language
  const csharpLang = await Language.load(csharpWasmPath);

  const parser = new Parser();
  parser.setLanguage(csharpLang);

  // Sample C# code covering imports, classes, structs, interfaces, enums, records, functions, and calls
  const sampleCsharp = `using System;
using System.Collections.Generic;
using System.Linq;
using static System.Math;

namespace Docuvia.Examples
{
    public interface IRepository<T>
    {
        T GetById(int id);
        IEnumerable<T> GetAll();
    }

    public enum Status
    {
        Active,
        Inactive,
        Pending
    }

    public struct Point
    {
        public int X { get; set; }
        public int Y { get; set; }

        public double DistanceTo(Point other)
        {
            return Sqrt(Pow(X - other.X, 2) + Pow(Y - other.Y, 2));
        }
    }

    public record UserRecord(int Id, string Name, string Email);

    public class UserService : IRepository<UserRecord>
    {
        private readonly List<UserRecord> _users;

        public UserService(List<UserRecord> users)
        {
            _users = users;
        }

        public UserRecord GetById(int id)
        {
            return _users.FirstOrDefault(u => u.Id == id);
        }

        public IEnumerable<UserRecord> GetAll()
        {
            return _users;
        }

        public void PrintUser(UserRecord user)
        {
            Console.WriteLine($"User: {user.Name} ({user.Email})");
        }

        public static UserService CreateDefault()
        {
            return new UserService(new List<UserRecord>());
        }

        public static implicit operator bool(UserService service)
        {
            return service._users.Count > 0;
        }
    }

    public class Program
    {
        public static void Main(string[] args)
        {
            var users = new List<UserRecord>
            {
                new UserRecord(1, "Alice", "alice@example.com"),
                new UserRecord(2, "Bob", "bob@example.com")
            };

            var service = new UserService(users);
            var user = service.GetById(1);
            service.PrintUser(user);

            var defaultService = UserService.CreateDefault();
            var status = Status.Active;
            Console.WriteLine($"Status: {status}");

            var point = new Point { X = 3, Y = 4 };
            var origin = new Point { X = 0, Y = 0 };
            Console.WriteLine($"Distance: {point.DistanceTo(origin)}");

            // Local function
            int Add(int a, int b) => a + b;
            Console.WriteLine($"2 + 3 = {Add(2, 3)}");
        }
    }
}
`;

  const tree = parser.parse(sampleCsharp);
  if (!tree) throw new Error('C#: parse returned null');
  const rootNode = tree.rootNode;

  // Load registry and get the C# provider
  const registryPath = path.resolve(__dirname, '../../..');
  const registry = await LanguageRegistry.load(registryPath);
  const provider = registry.getProviderForExtension('.cs');

  if (!provider) {
    console.error('❌ No provider found for .cs extension');
    process.exit(1);
  }

  console.log('=== C# AST Parsing Demo ===\n');

  // Extract imports
  const imports = provider.extractImports(rootNode);
  console.log(`📦 Imports (${imports.length}):`);
  for (const imp of imports) {
    console.log(`  - ${imp.text.substring(0, 80)}`);
  }

  // Extract classes
  const classes = provider.extractClasses(rootNode);
  console.log(`\n🏗️ Classes/Structs/Interfaces/Enums/Records (${classes.length}):`);
  for (const cls of classes) {
    const nameNode = cls.childForFieldName('name');
    console.log(`  - ${cls.type}: ${nameNode?.text ?? '(unnamed)'}`);
  }

  // Extract functions
  const functions = provider.extractFunctions(rootNode);
  console.log(`\n⚡ Functions/Methods/Constructors/Operators (${functions.length}):`);
  for (const fn of functions) {
    const nameNode = fn.childForFieldName('name');
    console.log(`  - ${fn.type}: ${nameNode?.text ?? '(unnamed)'}`);
  }

  // Extract calls
  const calls = provider.extractCalls(rootNode);
  console.log(`\n📞 Calls (${calls.length}):`);
  for (const call of calls) {
    const fnNode = call.childForFieldName('function') ?? call.childForFieldName('name');
    console.log(`  - ${call.type}: ${fnNode?.text ?? call.text.substring(0, 60)}`);
  }

  console.log('\n✅ C# AST parsing demo completed successfully!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
