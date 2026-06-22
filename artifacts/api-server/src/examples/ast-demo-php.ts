/**
 * AST Parsing Demo — PHP
 *
 * Demonstrates tree-sitter-php integration with the Docuvia language registry.
 * Parses a sample PHP file and extracts imports, classes, functions, and calls.
 */

import { Parser, Language } from "web-tree-sitter";
import path from "node:path";
import { createRequire } from "node:module";
import { LanguageRegistry } from "@workspace/ast-core";

const require = createRequire(import.meta.url);

async function main() {
  // Locate web-tree-sitter.wasm
  const tsWasmPath = path.join(
    path.dirname(require.resolve("web-tree-sitter")),
    "web-tree-sitter.wasm"
  );

  await Parser.init({ locateFile: () => tsWasmPath });

  // Locate tree-sitter-php.wasm
  const phpWasmPath = path.join(
    path.dirname(require.resolve("tree-sitter-php/package.json")),
    "tree-sitter-php.wasm"
  );

  // Load PHP language
  const phpLang = await Language.load(phpWasmPath);

  const parser = new Parser();
  parser.setLanguage(phpLang);

  // Sample PHP code covering imports, classes, interfaces, traits, enums, functions, and calls
  const samplePhp = `<?php

namespace App\\Services;

use App\\Models\\User;
use App\\Repositories\\UserRepository;
use function App\\Helpers\\format_name;
use const App\\Constants\\MAX_RETRIES;

require_once __DIR__ . '/bootstrap.php';

interface Cacheable {
    public function getCacheKey(): string;
    public function getTtl(): int;
}

trait HasTimestamps {
    public function getCreatedAt(): string {
        return $this->created_at;
    }

    public function getUpdatedAt(): string {
        return $this->updated_at;
    }
}

enum Status: string {
    case Active = 'active';
    case Inactive = 'inactive';

    public function label(): string {
        return match($this) {
            self::Active => 'Active',
            self::Inactive => 'Inactive',
        };
    }
}

class UserService implements Cacheable {
    use HasTimestamps;

    private UserRepository $repository;

    public function __construct(UserRepository $repository) {
        $this->repository = $repository;
    }

    public function getUserById(int $id): ?User {
        $cacheKey = $this->getCacheKey();
        $cached = cache()->get($cacheKey);
        if ($cached) {
            return $cached;
        }
        $user = $this->repository->find($id);
        format_name($user);
        return $user;
    }

    public function getCacheKey(): string {
        return "user:{$this->repository->getTable()}";
    }

    public function getTtl(): int {
        return 3600;
    }
}

function greet(string $name): string {
    return "Hello, {$name}!";
}

greet('World');

$service = new UserService(new UserRepository());
$service->getUserById(1);
`;

  const tree = parser.parse(samplePhp);
  if (!tree) throw new Error("PHP: parse returned null");
  const rootNode = tree.rootNode;

  // Load registry and get the PHP provider
  const registryPath = path.resolve(__dirname, "../../..");
  const registry = await LanguageRegistry.load(registryPath);
  const provider = registry.getProviderForExtension(".php");

  if (!provider) {
    console.error("❌ No provider found for .php extension");
    process.exit(1);
  }

  console.log("=== PHP AST Parsing Demo ===\n");

  // Extract imports
  const imports = provider.extractImports(rootNode);
  console.log(`📦 Imports (${imports.length}):`);
  for (const imp of imports) {
    console.log(`  - ${imp.text.substring(0, 80)}`);
  }

  // Extract classes
  const classes = provider.extractClasses(rootNode);
  console.log(`\n🏗️ Classes/Interfaces/Traits/Enums (${classes.length}):`);
  for (const cls of classes) {
    const nameNode = cls.childForFieldName("name");
    console.log(`  - ${cls.type}: ${nameNode?.text ?? "(unnamed)"}`);
  }

  // Extract functions
  const functions = provider.extractFunctions(rootNode);
  console.log(`\n⚡ Functions/Methods (${functions.length}):`);
  for (const fn of functions) {
    const nameNode = fn.childForFieldName("name");
    console.log(`  - ${fn.type}: ${nameNode?.text ?? "(unnamed)"}`);
  }

  // Extract calls
  const calls = provider.extractCalls(rootNode);
  console.log(`\n📞 Calls (${calls.length}):`);
  for (const call of calls) {
    const fnNode = call.childForFieldName("function") ?? call.childForFieldName("name");
    console.log(`  - ${call.type}: ${fnNode?.text ?? call.text.substring(0, 60)}`);
  }

  console.log("\n✅ PHP AST parsing demo completed successfully!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
