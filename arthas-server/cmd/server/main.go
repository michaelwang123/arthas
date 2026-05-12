package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/arthas/arthas-server/internal/game"
	"github.com/arthas/arthas-server/internal/network"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// 创建游戏实例
	g := game.NewGame()

	// 创建 WebSocket Hub
	hub := network.NewHub(g)

	// 启动游戏循环
	go g.Run(hub)

	// HTTP 路由
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		network.ServeWs(hub, w, r)
	})

	// 健康检查（用于 Cron-job.org 保活）
	http.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "pong")
	})

	// 静态信息
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"name":"arthas-server","status":"running"}`)
	})

	log.Printf("Arthas server starting on port %s", port)
	log.Printf("WebSocket endpoint: ws://localhost:%s/ws", port)

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
