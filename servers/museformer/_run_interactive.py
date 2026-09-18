"""
Thin wrapper around `fairseq_cli.interactive.cli_main()` -- see server.py's
`generate()` for why this exists instead of `python -m fairseq_cli.interactive`
directly.

Real, GPU-verified finding (see README.md "Status"): Museformer's decoder
calls two small vendored kernels, `range_fill` and `segment_arange`, which
each JIT-compile a real CUDA extension via `torch.utils.cpp_extension.load`
on first use -- and that needs a full `nvcc` toolchain. On a plain `pip`/`uv`
install there is no system CUDA devel toolkit, and the modern
`nvidia-cuda-nvcc-cu12` wheel no longer ships an `nvcc` binary (only
`ptxas`/`nvvm`), so that JIT compile always fails here -- a real
install-time gap, not a hypothetical one.

Both kernels already ship a `no_cuda_kernel` escape hatch (see
`vendor/museformer/kernels/{range_fill,segment_arange}/main.py`) that forces
their plain-PyTorch fallback even for CUDA tensors -- correct, just not
custom-kernel-accelerated for this one small bar/beat-id-construction step
(not the expensive per-layer attention). We can't pass that flag from the
CLI (museformer_decoder.py calls these with its own fixed argument list), so
this monkeypatches the module-level `*_cuda` entry points to the pytorch
fallback -- done here, not by hand-editing the vendored (`.gitignore`'d,
re-fetched) source.

Can't just pre-import `museformer.kernels...` and patch before calling
fairseq's own `cli_main()`: fairseq's `--user-dir` loader
(`fairseq.utils.import_user_module`) refuses to run if a module named
`museformer` is already in `sys.modules`, to guard against exactly this kind
of double-import ("not globally unique"). So this replicates
`fairseq_cli.interactive.cli_main()`'s own two-line body by hand, inserting
the patch in the one gap that matters: after `parse_args_and_arch()` (which
is what actually runs --user-dir's import) but before `call_main()` (which
is what first calls into the decoder).

A third kernel with the exact same CUDA-JIT/pytorch-fallback split,
`block_fill` (used by attention mask generation), was found live while
GPU-testing this -- README.md's kernel list only named range_fill/
segment_arange; block_fill wasn't mentioned there. Patched here too.
"""
from fairseq import options
from fairseq import distributed_utils
from fairseq_cli.interactive import main

_PATCHED_KERNEL_MODULES = [
    "museformer.kernels.range_fill.main",
    "museformer.kernels.segment_arange.main",
    "museformer.kernels.block_fill.main",
]


def cli_main():
    parser = options.get_interactive_generation_parser()
    args = options.parse_args_and_arch(parser)

    for module_name in _PATCHED_KERNEL_MODULES:
        mod = __import__(module_name, fromlist=["_"])
        cuda_fn_name = module_name.rsplit(".", 2)[1] + "_cuda"
        pytorch_fn_name = module_name.rsplit(".", 2)[1] + "_pytorch"
        setattr(mod, cuda_fn_name, getattr(mod, pytorch_fn_name))

    distributed_utils.call_main(args, main)


if __name__ == "__main__":
    cli_main()
