import java.util.List;
import java.util.ArrayList;

public class MyTestClass {
    private String name;

    public MyTestClass(String name) {
        this.name = name;
    }

    public void hello() {
        System.out.println("Hello " + name);
    }

    public static void myTestFunction() {
        List<String> items = new ArrayList<>();
        items.add("Testing");
        System.out.println(items);
    }
}

interface Greeter {
    void greet();
}

enum Color {
    RED, GREEN, BLUE
}
