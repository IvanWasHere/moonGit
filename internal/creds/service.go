// Package creds stores secrets in the OS keychain.
//
// Secrets never pass through the SQLite store or any file moonGit writes — the
// keychain is the only place they live, and it is the OS that decides whether
// to release them.
package creds

import (
	"errors"
	"fmt"
	"strings"

	"github.com/zalando/go-keyring"
)

// serviceName is the keychain service all moonGit entries are filed under, so
// a user can find and revoke them in Keychain Access.
const serviceName = "moonGit"

type Service struct{}

func New() *Service { return &Service{} }

// Set stores a secret for a key, typically a remote URL or host.
func (s *Service) Set(key, secret string) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("key is required")
	}
	if err := keyring.Set(serviceName, key, secret); err != nil {
		return fmt.Errorf("keychain write failed: %w", err)
	}
	return nil
}

// Lookup reports whether a secret exists and returns it.
//
// A missing entry is reported as found=false rather than an error: "no
// credential stored yet" is the normal first-run state, and the frontend's
// Result type should not have to distinguish it from a real keychain failure.
type Secret struct {
	Found bool   `json:"found"`
	Value string `json:"value,omitempty"`
}

func (s *Service) Get(key string) (Secret, error) {
	v, err := keyring.Get(serviceName, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return Secret{Found: false}, nil
	}
	if err != nil {
		return Secret{}, fmt.Errorf("keychain read failed: %w", err)
	}
	return Secret{Found: true, Value: v}, nil
}

// Delete removes a secret. Deleting a missing entry is not an error.
func (s *Service) Delete(key string) error {
	err := keyring.Delete(serviceName, key)
	if err == nil || errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return fmt.Errorf("keychain delete failed: %w", err)
}

// Available reports whether the keychain is usable at all.
//
// Worth probing at startup: in a headless session, or when the login keychain
// is locked, every credential operation will fail, and the UI should say so
// once rather than failing on each push.
func (s *Service) Available() bool {
	const probe = "__moongit_probe__"
	if err := keyring.Set(serviceName, probe, "1"); err != nil {
		return false
	}
	_ = keyring.Delete(serviceName, probe)
	return true
}
