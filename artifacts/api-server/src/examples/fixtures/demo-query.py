
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
