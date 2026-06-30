
require 'json'
require_relative 'my_helper'

module MyModule
  class MyTestClass
    def hello
      puts "Hello World"
    end
  end

  def self.module_method
    puts "Module method"
  end
end

def my_test_function
  puts "Testing"
end

class AnotherClass < MyModule::MyTestClass
  def initialize
    @value = 42
  end

  def greet(name)
    puts "Hello, #{name}!"
  end
end

obj = AnotherClass.new
obj.greet("World")
MyModule::MyTestClass.new.hello
