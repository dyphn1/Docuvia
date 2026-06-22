import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import parseAst from "../lib/ast/ast-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log("=== AST Query API Demo ===\n");

  // Test Python parsing with Query API
  const pyFile = path.join(__dirname, "dummy-query.py");
  await fs.writeFile(
    pyFile,
    `
import os
from sys import path
from collections import OrderedDict

class MyTestClass:
    def hello(self):
        print("Hello World")

class AnotherClass(MyTestClass):
    pass

def my_test_function():
    print("Testing")

def another_function(x, y):
    return x + y

my_test_function()
another_function(1, 2)
`,
    "utf-8"
  );

  console.log("--- Python (Query API) ---");
  const pyResult = await parseAst(pyFile);
  if (pyResult.status === "done" && pyResult.file) {
    const output = await fs.readFile(pyResult.file, "utf-8");
    console.log(output);
  } else {
    console.error("Python parsing failed:", pyResult.reason);
  }

  // Test Rust parsing with Query API
  const rsFile = path.join(__dirname, "dummy-query.rs");
  await fs.writeFile(
    rsFile,
    `
use std::collections::HashMap;
use std::fmt;

struct MyStruct {
    value: i32,
}

enum MyEnum {
    A,
    B,
}

trait MyTrait {
    fn do_something(&self);
}

fn my_function() {
    println!("Hello");
}

fn another_function(x: i32) -> i32 {
    x + 1
}

fn main() {
    my_function();
    another_function(42);
}
`,
    "utf-8"
  );

  console.log("--- Rust (Query API) ---");
  const rsResult = await parseAst(rsFile);
  if (rsResult.status === "done" && rsResult.file) {
    const output = await fs.readFile(rsResult.file, "utf-8");
    console.log(output);
  } else {
    console.error("Rust parsing failed:", rsResult.reason);
  }

  // Test Go parsing with Query API
  const goFile = path.join(__dirname, "dummy-query.go");
  await fs.writeFile(
    goFile,
    `
package main

import "fmt"
import "net/http"

type MyServer struct {
    port int
}

func NewServer(port int) *MyServer {
    return &MyServer{port: port}
}

func (s *MyServer) Start() {
    http.HandleFunc("/", handler)
    fmt.Println("Starting...")
}

func handler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "Hello")
}

func main() {
    server := NewServer(8080)
    server.Start()
}
`,
    "utf-8"
  );

  console.log("--- Go (Query API) ---");
  const goResult = await parseAst(goFile);
  if (goResult.status === "done" && goResult.file) {
    const output = await fs.readFile(goResult.file, "utf-8");
    console.log(output);
  } else {
    console.error("Go parsing failed:", goResult.reason);
  }

  // Cleanup
  await fs.rm(pyFile);
  await fs.rm(rsFile);
  await fs.rm(goFile);

  console.log("=== Query API Demo Complete ===");
}

run().catch(console.error);
