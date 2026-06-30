
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
