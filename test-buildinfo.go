package main

import (
	"fmt"
	"runtime/debug"
)

func main() {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		fmt.Println("No build info available")
		return
	}

	fmt.Printf("Main module: %s@%s\n", info.Main.Path, info.Main.Version)
	fmt.Println("\nDependencies:")
	for _, dep := range info.Deps {
		fmt.Printf("  %s@%s\n", dep.Path, dep.Version)
	}
}
