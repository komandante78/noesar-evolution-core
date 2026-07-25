# Direct Unraid installation

Run as root from the extracted Package 2 directory:

```bash
./INSTALLATION/install-unraid.sh
./INSTALLATION/verify-installation.sh
```

The installer builds one external Docker image and starts one external container.
It does not delete existing containers automatically and it preserves the
persistent workspace during uninstall.
