package main

import (
  "fmt"
  "net/http"
)

type Server struct {
  port int
}

func (s *Server) Start() error {
  return http.ListenAndServe(fmt.Sprintf(":%d", s.port), nil)
}

func helper() {}

func main() {
  s := Server{port: 8080}
  s.Start()
  fmt.Println("started")
}
