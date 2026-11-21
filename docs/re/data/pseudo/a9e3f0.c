
long * FUN_00a9e3f0(long *param_1,long param_2,int param_3)

{
  byte *pbVar1;
  int iVar2;
  void *__dest;
  undefined **ppuVar3;
  char cVar4;
  undefined2 uVar5;
  uint uVar6;
  int iVar7;
  int iVar8;
  undefined8 uVar9;
  undefined8 *puVar10;
  long *plVar11;
  ulong __n;
  long lVar12;
  void *__src;
  undefined1 local_1d8 [9];
  undefined2 uStack_1cf;
  undefined5 uStack_1cd;
  void *local_1c8;
  undefined **local_1b8;
  undefined **local_1b0;
  undefined **local_1a8;
  undefined **local_1a0;
  long local_198;
  undefined **local_190;
  byte local_188 [16];
  void *local_178;
  uint local_16c;
  void *local_168;
  uint local_160;
  uint local_15c;
  undefined **local_158;
  undefined8 uStack_150;
  undefined **local_148;
  undefined **local_140 [8];
  undefined1 local_100 [16];
  undefined1 local_f0 [16];
  undefined4 local_e0;
  undefined **local_d8 [17];
  undefined8 local_50;
  undefined4 local_48;
  ulong local_40;
  long local_38;
  
  local_16c = 500;
  if (param_3 != 0) {
    local_16c = 0x454;
  }
  local_198 = param_2;
  if (*(uint *)(param_2 + 0x10) <= local_16c) {
    local_148 = &PTR_LAB_00fae798;
    local_d8[0] = &PTR_LAB_00fae8e0;
    local_158 = &PTR_FUN_00fae8b8;
    uStack_150 = 0;
                    /* try { // try from 00a9e470 to 00a9e477 has its CatchHandler @ 00a9eef3 */
    FUN_00a4edb0(local_d8,local_140);
    local_50 = 0;
    local_48 = 0xffffffff;
    local_158 = (undefined **)&DAT_00fae770;
    local_d8[0] = &PTR_LAB_00fae7c0;
    local_148 = &PTR_LAB_00fae798;
                    /* try { // try from 00a9e4af to 00a9e4b6 has its CatchHandler @ 00a9eed6 */
    FUN_00a4fac0(local_140);
    local_140[0] = &PTR_LAB_00fae968;
    local_f0 = (undefined1  [16])0x0;
    local_100 = (undefined1  [16])0x0;
    local_e0 = 0x18;
                    /* try { // try from 00a9e4f3 to 00a9e535 has its CatchHandler @ 00a9ef1a */
    uVar9 = FUN_00427500(&local_148,
                         "Assertion \"needsSplitting(is_ipv6)\" failed at ../../../../deps/teamspeak_common_lib/src/packet/outgoingresendingpacket.cpp:"
                         ,0x7b);
    uVar9 = FUN_00a56570(uVar9,0x1f);
    uVar9 = FUN_00427500(uVar9,"; ",2);
    FUN_00427500(uVar9,&DAT_00bebd6a,0);
                    /* try { // try from 00a9e536 to 00a9e542 has its CatchHandler @ 00a9eed4 */
    FUN_004277d0(local_188,local_140);
    local_1c8 = (void *)0x0;
    local_1d8._1_8_ = 0x656b63615074754f;
    local_1d8[0] = 0x12;
    uStack_1cd = SUB165((undefined1  [16])0x0,0xb);
    uStack_1cf = 0x74;
                    /* try { // try from 00a9e56f to 00a9e57f has its CatchHandler @ 00a9eeae */
    FUN_0042c200(local_188,0,local_1d8,0);
    if ((local_1d8[0] & 1) != 0) {
      operator_delete(local_1c8);
    }
    if ((local_188[0] & 1) != 0) {
      operator_delete(local_178);
    }
    local_158 = (undefined **)&DAT_00fae770;
    local_d8[0] = &PTR_LAB_00fae7c0;
    local_148 = &PTR_LAB_00fae798;
    local_140[0] = &PTR_LAB_00fae968;
    if ((local_100[0] & 1) != 0) {
      operator_delete((void *)local_f0._0_8_);
    }
    FUN_00a4f8b0(local_140);
    FUN_00a59ea0(&local_158,&PTR_PTR_00fae7d8);
    thunk_FUN_00a4e4f0(local_d8);
  }
  lVar12 = local_198;
  *param_1 = (long)param_1;
  param_1[1] = (long)param_1;
  *(undefined1 (*) [16])(param_1 + 2) = (undefined1  [16])0x0;
  local_168 = *(void **)(local_198 + 8);
                    /* try { // try from 00a9e623 to 00a9e627 has its CatchHandler @ 00a9ef15 */
  uVar6 = FUN_004a0850();
  iVar2 = *(int *)(lVar12 + 0x10);
                    /* try { // try from 00a9e62f to 00a9e633 has its CatchHandler @ 00a9ef10 */
  iVar7 = FUN_004a0850();
                    /* try { // try from 00a9e637 to 00a9e63b has its CatchHandler @ 00a9ef0b */
  iVar8 = FUN_004a0850();
  local_15c = iVar2 - iVar7;
  if (local_15c != 0) {
    local_168 = (void *)((long)local_168 + (ulong)uVar6);
    local_40 = (ulong)(local_16c - iVar8);
    local_160 = (local_16c - iVar8) - 2;
    local_38 = lVar12 + 0x88;
    local_1b0 = &PTR_LAB_00fae968;
    local_1b8 = &PTR_PTR_00fae7d8;
    local_1a0 = &PTR_LAB_00fae798;
    do {
      __n = (ulong)local_15c;
      if ((uint)local_40 < local_15c) {
        __n = local_40 & 0xffffffff;
        if (local_15c - (uint)local_40 < 3) {
          __n = (ulong)local_160;
        }
      }
                    /* try { // try from 00a9e6d6 to 00a9e6eb has its CatchHandler @ 00a9f15f */
      cVar4 = FUN_0049fc60(lVar12);
      if (cVar4 == '\x02') {
        puVar10 = operator_new(0xb0);
                    /* try { // try from 00a9e6ef to 00a9e6f9 has its CatchHandler @ 00a9f03f */
        FUN_00a9f2c0(puVar10,__n);
        *puVar10 = &PTR_FUN_00fd0048;
        *(undefined1 *)((long)puVar10 + 0xae) = *(undefined1 *)(local_198 + 0xae);
        *(undefined1 *)((long)puVar10 + 0xaf) = *(undefined1 *)(local_198 + 0xaf);
      }
      else {
                    /* try { // try from 00a9e730 to 00a9e739 has its CatchHandler @ 00a9f15f */
        cVar4 = FUN_0049fc60(local_198);
        ppuVar3 = local_1a0;
        if (cVar4 != '\x03') {
          local_148 = local_1a0;
          local_d8[0] = &PTR_LAB_00fae8e0;
          local_158 = &PTR_FUN_00fae8b8;
          uStack_150 = 0;
                    /* try { // try from 00a9e777 to 00a9e78e has its CatchHandler @ 00a9efbd */
          FUN_00a4edb0(local_d8,local_140);
          local_50 = 0;
          local_48 = 0xffffffff;
          local_1a8 = (undefined **)&DAT_00fae770;
          local_158 = (undefined **)&DAT_00fae770;
          local_190 = &PTR_LAB_00fae7c0;
          local_d8[0] = &PTR_LAB_00fae7c0;
          local_148 = ppuVar3;
                    /* try { // try from 00a9e7da to 00a9e7e1 has its CatchHandler @ 00a9efbb */
          FUN_00a4fac0(local_140);
          local_140[0] = local_1b0;
          local_f0 = (undefined1  [16])0x0;
          local_100 = (undefined1  [16])0x0;
          local_e0 = 0x18;
                    /* try { // try from 00a9e813 to 00a9e85d has its CatchHandler @ 00a9f04f */
          uVar9 = FUN_00427500(&local_148,
                               "Assertion \"getType() == COMMAND_LOW\" failed at ../../../../deps/teamspeak_common_lib/src/packet/outgoingresendingpacket.cpp:"
                               ,0x7c);
          uVar9 = FUN_00a56570(uVar9,0x36);
          uVar9 = FUN_00427500(uVar9,"; ",2);
          FUN_00427500(uVar9,&DAT_00bebd6a,0);
                    /* try { // try from 00a9e85e to 00a9e872 has its CatchHandler @ 00a9efb6 */
          FUN_004277d0(local_188,local_140);
          local_1c8 = (void *)0x0;
          local_1d8._1_8_ = 0x656b63615074754f;
          local_1d8[0] = 0x12;
          uStack_1cf._0_1_ = 0x74;
          uStack_1cd = SUB165((undefined1  [16])0x0,0xb);
          uStack_1cf._1_1_ = 0;
                    /* try { // try from 00a9e8a4 to 00a9e8b2 has its CatchHandler @ 00a9ef89 */
          FUN_0042c200(local_188,0,local_1d8,0);
          if ((local_1d8[0] & 1) != 0) {
            operator_delete(local_1c8);
          }
          if ((local_188[0] & 1) != 0) {
            operator_delete(local_178);
          }
          local_158 = local_1a8;
          local_d8[0] = local_190;
          local_148 = ppuVar3;
          local_140[0] = local_1b0;
          if ((local_100[0] & 1) != 0) {
            operator_delete((void *)local_f0._0_8_);
          }
          FUN_00a4f8b0(local_140);
          FUN_00a59ea0(&local_158,local_1b8);
          thunk_FUN_00a4e4f0(local_d8);
        }
                    /* try { // try from 00a9e94f to 00a9e958 has its CatchHandler @ 00a9f15f */
        puVar10 = operator_new(0xb0);
                    /* try { // try from 00a9e95c to 00a9e966 has its CatchHandler @ 00a9f03d */
        FUN_00a9f2c0(puVar10,__n);
        *puVar10 = &PTR_FUN_00fd0068;
      }
                    /* try { // try from 00a9e979 to 00a9e999 has its CatchHandler @ 00a9f15f */
      FUN_004a5640(puVar10 + 0x11,local_38);
      *(undefined4 *)(puVar10 + 4) = *(undefined4 *)(local_198 + 0x20);
      uVar6 = FUN_0049fcb0(puVar10);
      ppuVar3 = local_1a0;
      if (local_16c < uVar6) {
        local_148 = local_1a0;
        local_d8[0] = &PTR_LAB_00fae8e0;
        local_158 = &PTR_FUN_00fae8b8;
        uStack_150 = 0;
                    /* try { // try from 00a9e9dc to 00a9e9f3 has its CatchHandler @ 00a9f035 */
        FUN_00a4edb0(local_d8,local_140);
        local_50 = 0;
        local_48 = 0xffffffff;
        local_158 = (undefined **)&DAT_00fae770;
        local_1a8 = &PTR_LAB_00fae7c0;
        local_d8[0] = &PTR_LAB_00fae7c0;
        local_148 = ppuVar3;
                    /* try { // try from 00a9ea37 to 00a9ea3e has its CatchHandler @ 00a9f02d */
        FUN_00a4fac0(local_140);
        local_190 = (undefined **)&DAT_00fae770;
        local_140[0] = local_1b0;
        local_f0 = (undefined1  [16])0x0;
        local_100 = (undefined1  [16])0x0;
        local_e0 = 0x18;
                    /* try { // try from 00a9ea72 to 00a9eac4 has its CatchHandler @ 00a9f0e3 */
        uVar9 = FUN_00427500(&local_148,
                             "Assertion \"packet->getPacketSize() <= get_packet_mtu(is_ipv6)\" failed at ../../../../deps/teamspeak_common_lib/src/packet/outgoingresendingpacket.cpp:"
                             ,0x96);
        uVar9 = FUN_00a56570(uVar9,0x3b);
        uVar9 = FUN_00427500(uVar9,"; ",2);
        FUN_00427500(uVar9,&DAT_00bebd6a,0);
                    /* try { // try from 00a9eac5 to 00a9ead9 has its CatchHandler @ 00a9f028 */
        FUN_004277d0(local_188,local_140);
        local_1c8 = (void *)0x0;
        local_1d8._1_8_ = 0x656b63615074754f;
        local_1d8[0] = 0x12;
        uStack_1cf._0_1_ = 0x74;
        uStack_1cd = SUB165((undefined1  [16])0x0,0xb);
        uStack_1cf._1_1_ = 0;
                    /* try { // try from 00a9eb0e to 00a9eb1c has its CatchHandler @ 00a9effb */
        FUN_0042c200(local_188,0,local_1d8,0);
        ppuVar3 = local_190;
        if ((local_1d8[0] & 1) != 0) {
          operator_delete(local_1c8);
        }
        if ((local_188[0] & 1) != 0) {
          operator_delete(local_178);
        }
        local_158 = ppuVar3;
        local_d8[0] = local_1a8;
        local_148 = local_1a0;
        local_140[0] = local_1b0;
        if ((local_100[0] & 1) != 0) {
          operator_delete((void *)local_f0._0_8_);
        }
        FUN_00a4f8b0(local_140);
        FUN_00a59ea0(&local_158,local_1b8);
        thunk_FUN_00a4e4f0(local_d8);
      }
      ppuVar3 = local_1a0;
      __src = *(void **)(local_198 + 8);
      if ((*(byte *)((long)__src + 10) & 0x10) != 0) {
        local_190 = (undefined **)CONCAT44(local_190._4_4_,(int)__n);
        local_148 = local_1a0;
        local_d8[0] = &PTR_LAB_00fae8e0;
        local_158 = &PTR_FUN_00fae8b8;
        uStack_150 = 0;
                    /* try { // try from 00a9ec07 to 00a9ec16 has its CatchHandler @ 00a9eff3 */
        FUN_00a4edb0(local_d8,local_140);
        local_50 = 0;
        local_48 = 0xffffffff;
        local_158 = (undefined **)&DAT_00fae770;
        local_1a8 = &PTR_LAB_00fae7c0;
        local_d8[0] = &PTR_LAB_00fae7c0;
        local_148 = ppuVar3;
                    /* try { // try from 00a9ec5a to 00a9ec64 has its CatchHandler @ 00a9eff1 */
        FUN_00a4fac0(local_140);
        local_140[0] = local_1b0;
        local_f0 = (undefined1  [16])0x0;
        local_100 = (undefined1  [16])0x0;
        local_e0 = 0x18;
                    /* try { // try from 00a9ec93 to 00a9ece2 has its CatchHandler @ 00a9f069 */
        uVar9 = FUN_00427500(&local_148,
                             "Assertion \"!hasFragmentFlag()\" failed at ../../../../deps/teamspeak_common_lib/src/packet/outgoingresendingpacket.cpp:"
                             ,0x76);
        uVar9 = FUN_00a56570(uVar9,0x3c);
        uVar9 = FUN_00427500(uVar9,"; ",2);
        FUN_00427500(uVar9,&DAT_00bebd6a,0);
                    /* try { // try from 00a9ece3 to 00a9eced has its CatchHandler @ 00a9efef */
        FUN_004277d0(local_188,local_140);
        local_1c8 = (void *)0x0;
        local_1d8._1_8_ = 0x656b63615074754f;
        local_1d8[0] = 0x12;
        uStack_1cf._0_1_ = 0x74;
        uStack_1cd = SUB165((undefined1  [16])0x0,0xb);
        uStack_1cf._1_1_ = 0;
                    /* try { // try from 00a9ed1f to 00a9ed2d has its CatchHandler @ 00a9efc5 */
        FUN_0042c200(local_188,0,local_1d8,0);
        if ((local_1d8[0] & 1) != 0) {
          operator_delete(local_1c8);
        }
        if ((local_188[0] & 1) != 0) {
          operator_delete(local_178);
        }
        local_158 = (undefined **)&DAT_00fae770;
        local_d8[0] = local_1a8;
        local_148 = local_1a0;
        local_140[0] = local_1b0;
        if ((local_100[0] & 1) != 0) {
          operator_delete((void *)local_f0._0_8_);
        }
        FUN_00a4f8b0(local_140);
        FUN_00a59ea0(&local_158,local_1b8);
        thunk_FUN_00a4e4f0(local_d8);
        __src = *(void **)(local_198 + 8);
        __n = (ulong)local_190 & 0xffffffff;
      }
      __dest = (void *)puVar10[1];
                    /* try { // try from 00a9edce to 00a9edd2 has its CatchHandler @ 00a9f15f */
      uVar6 = FUN_004a0850();
      memcpy(__dest,__src,(ulong)uVar6);
      *(byte *)(puVar10[1] + 10) = *(byte *)(puVar10[1] + 10) & 0xbf;
      lVar12 = puVar10[1];
                    /* try { // try from 00a9edec to 00a9edf0 has its CatchHandler @ 00a9f15f */
      uVar6 = FUN_004a0850();
      memcpy((void *)(lVar12 + (ulong)uVar6),local_168,__n);
                    /* try { // try from 00a9ee09 to 00a9ee2c has its CatchHandler @ 00a9f15f */
      uVar5 = FUN_0049fc40(local_198);
      FUN_0049fd00(puVar10,uVar5);
      param_1[3] = param_1[3] + 1;
      plVar11 = operator_new(0x18);
      plVar11[2] = (long)puVar10;
      plVar11[1] = (long)param_1;
      lVar12 = *param_1;
      *plVar11 = lVar12;
      *(long **)(lVar12 + 8) = plVar11;
      *param_1 = (long)plVar11;
      param_1[2] = param_1[2] + 1;
      local_15c = local_15c - (int)__n;
      local_168 = (void *)((long)local_168 + __n);
      lVar12 = local_198;
    } while (local_15c != 0);
  }
  pbVar1 = (byte *)(*(long *)(*(long *)(param_1[1] + 0x10) + 8) + 10);
  *pbVar1 = *pbVar1 | 0x10;
  pbVar1 = (byte *)(*(long *)(*(long *)(*param_1 + 0x10) + 8) + 10);
  *pbVar1 = *pbVar1 | 0x10;
  if ((*(byte *)(*(long *)(lVar12 + 8) + 10) & 0x40) != 0) {
    pbVar1 = (byte *)(*(long *)(*(long *)(param_1[1] + 0x10) + 8) + 10);
    *pbVar1 = *pbVar1 | 0x40;
  }
  return param_1;
}

