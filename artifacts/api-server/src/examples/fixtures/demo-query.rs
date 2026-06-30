
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
