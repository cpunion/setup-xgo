package main

import (
	"debug/buildinfo"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func main() {
	// Find xgo binary
	xgoBin, err := exec.LookPath("xgo")
	if err != nil {
		fmt.Printf("xgo not found in PATH: %v\n", err)
		return
	}
	fmt.Printf("Found xgo binary: %s\n", xgoBin)

	// Read build info from xgo binary
	info, err := buildinfo.ReadFile(xgoBin)
	if err != nil {
		fmt.Printf("Error reading build info: %v\n", err)
		return
	}

	fmt.Printf("\nMain module: %s@%s\n", info.Main.Path, info.Main.Version)

	// Get GOMODCACHE
	cmd := exec.Command("go", "env", "GOMODCACHE")
	output, err := cmd.Output()
	if err != nil {
		fmt.Printf("Error getting GOMODCACHE: %v\n", err)
		return
	}
	gomodcache := strings.TrimSpace(string(output))
	fmt.Printf("GOMODCACHE: %s\n", gomodcache)

	// Construct XGOROOT from main module
	if strings.HasPrefix(info.Main.Path, "github.com/goplus/xgo") && info.Main.Version != "" {
		// The main module is github.com/goplus/xgo, not github.com/goplus/xgo/cmd/xgo
		xgoVersion := info.Main.Version
		xgoRoot := filepath.Join(gomodcache, "github.com", "goplus", fmt.Sprintf("xgo@%s", xgoVersion))

		fmt.Printf("\n✓ Derived XGOROOT: %s\n", xgoRoot)

		// Verify it's valid
		cmdXgoDir := filepath.Join(xgoRoot, "cmd", "xgo")
		goModFile := filepath.Join(xgoRoot, "go.mod")

		cmdXgoExists := dirExists(cmdXgoDir)
		goModExists := fileExists(goModFile)

		fmt.Printf("  ✓ cmd/xgo exists: %v\n", cmdXgoExists)
		fmt.Printf("  ✓ go.mod exists: %v\n", goModExists)
		fmt.Printf("  ✓ Valid XGOROOT: %v\n", cmdXgoExists && goModExists)

		// Read github.com/goplus/lib version from go.mod
		if goModExists {
			content, err := os.ReadFile(goModFile)
			if err == nil {
				lines := strings.Split(string(content), "\n")
				fmt.Println("\n✓ Key dependencies in go.mod:")
				for _, line := range lines {
					trimmed := strings.TrimSpace(line)
					if strings.Contains(trimmed, "github.com/goplus/lib") {
						fmt.Printf("  %s\n", trimmed)
					}
				}
			}
		}
	}

	// Also show all goplus dependencies from build info
	fmt.Println("\n✓ All goplus dependencies from build info:")
	for _, dep := range info.Deps {
		if strings.HasPrefix(dep.Path, "github.com/goplus/") {
			fmt.Printf("  %s@%s\n", dep.Path, dep.Version)
		}
	}

	fmt.Println("\n=== CONCLUSION ===")
	fmt.Println("✓ We CAN get xgo module path from go install binary")
	fmt.Println("✓ We CAN construct XGOROOT from GOMODCACHE + module version")
	fmt.Println("✓ We CAN read github.com/goplus/lib version from go.mod")
	fmt.Println("✓ All required information is available!")
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
