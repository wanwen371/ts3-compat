
void FUN_00a98000(long param_1,undefined4 param_2,long *param_3,long *param_4,ulong param_5,
                 undefined4 param_6,char param_7)

{
  long *plVar1;
  int *piVar2;
  short sVar3;
  long *plVar4;
  char cVar5;
  char cVar6;
  undefined2 uVar7;
  int iVar8;
  int iVar9;
  undefined4 uVar10;
  uint uVar11;
  undefined8 uVar12;
  uint uVar13;
  ulong uVar14;
  undefined8 extraout_RDX;
  byte *pbVar15;
  ulong uVar16;
  uint uVar17;
  long lVar18;
  long lVar19;
  undefined1 auVar20 [16];
  undefined1 local_1d8 [16];
  void *local_1c8;
  uint local_1bc;
  byte local_1b8;
  undefined7 uStack_1b7;
  byte *local_1b0;
  void *local_1a8;
  undefined4 local_1a0;
  undefined4 uStack_19c;
  long local_198;
  undefined4 local_18c;
  uint local_188;
  undefined4 uStack_184;
  undefined4 uStack_180;
  undefined4 uStack_17c;
  undefined4 local_178;
  undefined4 uStack_174;
  undefined4 local_170;
  undefined4 uStack_16c;
  undefined1 local_130 [16];
  undefined1 local_120 [16];
  undefined4 local_110;
  undefined **local_108 [17];
  undefined8 local_80;
  undefined4 local_78;
  undefined4 local_6c;
  undefined1 local_68 [16];
  void *local_58;
  short *local_50;
  long *local_48;
  long local_40;
  long *local_38;
  
  uVar14 = param_5 & 0xffffffff;
  lVar19 = *param_3;
  local_18c = param_6;
  local_6c = param_2;
  local_48 = param_3;
  if ((((char)param_6 != '\0') && (cVar5 = FUN_0049fc60(param_4), cVar5 != '\b')) &&
     (cVar5 = FUN_0049f4a0(param_5 & 0xff), cVar5 == '\0')) {
    local_1bc = (uint)param_5;
    local_178 = 0xfae798;
    uStack_174 = 0;
    local_108[0] = &PTR_LAB_00fae8e0;
    local_188 = 0xfae8b8;
    uStack_184 = 0;
    uStack_180 = 0;
    uStack_17c = 0;
                    /* try { // try from 00a980a1 to 00a980a8 has its CatchHandler @ 00a99486 */
    FUN_00a4edb0(local_108,&local_170);
    local_80 = 0;
    local_78 = 0xffffffff;
    local_188 = 0xfae770;
    uStack_184 = 0;
    local_108[0] = &PTR_LAB_00fae7c0;
    local_178 = 0xfae798;
    uStack_174 = 0;
                    /* try { // try from 00a980da to 00a980e1 has its CatchHandler @ 00a99481 */
    FUN_00a4fac0(&local_170);
    local_170 = 0xfae968;
    uStack_16c = 0;
    local_120 = (undefined1  [16])0x0;
    local_130 = (undefined1  [16])0x0;
    local_110 = 0x18;
                    /* try { // try from 00a98118 to 00a9815a has its CatchHandler @ 00a9956e */
    uVar12 = FUN_00427500(&local_178,
                          "Assertion \"!skipPacketIDBranding || packet->getType()==INIT1 || isResendingPacketType(packetType)\" failed at ../../../../deps/teamspeak_common_lib/src/packethandler_base.cpp:"
                          ,0xae);
    uVar12 = FUN_00a56570(uVar12,0x2ad);
    uVar12 = FUN_00427500(uVar12,"; ",2);
    FUN_00427500(uVar12,&DAT_00bebd6a,0);
                    /* try { // try from 00a9815b to 00a98169 has its CatchHandler @ 00a9947c */
    FUN_004277d0(&local_1b8,&local_170);
    local_1c8 = (void *)0x0;
    local_1d8._1_8_ = 0x6c646e6148746b50;
    local_1d8[0] = 0x14;
    local_1d8._9_2_ = 0x7265;
    local_1d8._12_4_ = SUB164((undefined1  [16])0x0,0xc);
    local_1d8[0xb] = 0;
                    /* try { // try from 00a981a6 to 00a981b6 has its CatchHandler @ 00a9944c */
    FUN_0042c200(&local_1b8,0,local_1d8,*(undefined8 *)(param_1 + 0x58));
    if ((local_1d8[0] & 1) != 0) {
      operator_delete(local_1c8);
    }
    if ((local_1b8 & 1) != 0) {
      operator_delete(local_1a8);
    }
    local_188 = 0xfae770;
    uStack_184 = 0;
    local_108[0] = &PTR_LAB_00fae7c0;
    local_178 = 0xfae798;
    uStack_174 = 0;
    local_170 = 0xfae968;
    uStack_16c = 0;
    if ((local_130[0] & 1) != 0) {
      operator_delete((void *)local_120._0_8_);
    }
    FUN_00a4f8b0(&local_170);
    FUN_00a59ea0(&local_188,&PTR_PTR_00fae7d8);
    thunk_FUN_00a4e4f0(local_108);
    uVar14 = (ulong)local_1bc;
  }
  cVar5 = FUN_0049fc60(param_4);
  if (cVar5 != (char)uVar14) {
    local_1bc = (uint)uVar14;
    local_178 = 0xfae798;
    uStack_174 = 0;
    local_108[0] = &PTR_LAB_00fae8e0;
    local_188 = 0xfae8b8;
    uStack_184 = 0;
    uStack_180 = 0;
    uStack_17c = 0;
                    /* try { // try from 00a9828d to 00a98294 has its CatchHandler @ 00a9959d */
    FUN_00a4edb0(local_108,&local_170);
    local_80 = 0;
    local_78 = 0xffffffff;
    local_188 = 0xfae770;
    uStack_184 = 0;
    local_108[0] = &PTR_LAB_00fae7c0;
    local_178 = 0xfae798;
    uStack_174 = 0;
    local_198 = lVar19;
                    /* try { // try from 00a982cb to 00a982d2 has its CatchHandler @ 00a99596 */
    FUN_00a4fac0(&local_170);
    local_170 = 0xfae968;
    uStack_16c = 0;
    local_120 = (undefined1  [16])0x0;
    local_130 = (undefined1  [16])0x0;
    local_110 = 0x18;
                    /* try { // try from 00a98309 to 00a9834b has its CatchHandler @ 00a995df */
    uVar12 = FUN_00427500(&local_178,
                          "Assertion \"packet->getType() == packetType\" failed at ../../../../deps/teamspeak_common_lib/src/packethandler_base.cpp:"
                          ,0x77);
    uVar12 = FUN_00a56570(uVar12,0x2ae);
    uVar12 = FUN_00427500(uVar12,"; ",2);
    FUN_00427500(uVar12,&DAT_00bebd6a,0);
                    /* try { // try from 00a9834c to 00a9835a has its CatchHandler @ 00a9956c */
    FUN_004277d0(&local_1b8,&local_170);
    local_1c8 = (void *)0x0;
    local_1d8._1_8_ = 0x6c646e6148746b50;
    local_1d8[0] = 0x14;
    local_1d8._9_2_ = 0x7265;
    local_1d8._12_4_ = SUB164((undefined1  [16])0x0,0xc);
    local_1d8[0xb] = 0;
                    /* try { // try from 00a98397 to 00a983a7 has its CatchHandler @ 00a9953f */
    FUN_0042c200(&local_1b8,0,local_1d8,*(undefined8 *)(param_1 + 0x58));
    if ((local_1d8[0] & 1) != 0) {
      operator_delete(local_1c8);
    }
    if ((local_1b8 & 1) != 0) {
      operator_delete(local_1a8);
    }
    local_188 = 0xfae770;
    uStack_184 = 0;
    local_108[0] = &PTR_LAB_00fae7c0;
    local_178 = 0xfae798;
    uStack_174 = 0;
    local_170 = 0xfae968;
    uStack_16c = 0;
    if ((local_130[0] & 1) != 0) {
      operator_delete((void *)local_120._0_8_);
    }
    FUN_00a4f8b0(&local_170);
    FUN_00a59ea0(&local_188,&PTR_PTR_00fae7d8);
    thunk_FUN_00a4e4f0(local_108);
    uVar14 = (ulong)local_1bc;
    lVar19 = local_198;
  }
  uVar17 = (uint)uVar14;
  uVar11 = local_188 >> 8;
  local_188 = local_188 & 0xffffff00;
  if (*(char *)(lVar19 + 0x41c) != '\0') {
    uStack_174 = (undefined4)*(undefined8 *)(lVar19 + 0x430);
    local_170 = (undefined4)((ulong)*(undefined8 *)(lVar19 + 0x430) >> 0x20);
    uStack_184 = (undefined4)*(undefined8 *)(lVar19 + 0x420);
    uStack_180 = (undefined4)((ulong)*(undefined8 *)(lVar19 + 0x420) >> 0x20);
    uStack_17c = (undefined4)*(undefined8 *)(lVar19 + 0x428);
    local_178 = (undefined4)((ulong)*(undefined8 *)(lVar19 + 0x428) >> 0x20);
    local_188 = CONCAT31((int3)uVar11,1);
  }
                    /* try { // try from 00a9845d to 00a98469 has its CatchHandler @ 00a995c0 */
  FUN_004a08c0(param_4,&local_188);
  if ((char)local_188 != '\0') {
    local_188 = local_188 & 0xffffff00;
  }
  uVar16 = uVar14 & 0xff;
  cVar5 = FUN_0049f4a0(uVar16);
  if (cVar5 != '\0') {
    sVar3 = *(short *)(lVar19 + 0x400);
    if (((char)local_18c == '\0') && (cVar5 = FUN_0045d960(lVar19), cVar5 != '\0')) {
      FUN_00a9f1c0(param_4,sVar3 != 2);
    }
    cVar5 = FUN_00a9e3d0(param_4,sVar3 != 2);
    if (cVar5 != '\0') {
      FUN_00a9e3f0(&local_1b8,param_4,sVar3 != 2);
      if (param_4 != (long *)0x0) {
        (**(code **)(*param_4 + 8))(param_4);
      }
                    /* try { // try from 00a984ff to 00a98509 has its CatchHandler @ 00a994ae */
      auVar20 = FUN_0045e5a0(lVar19,uVar16,local_1a0);
      lVar18 = auVar20._8_8_;
      if (auVar20[0] == '\0') {
        local_178 = 0xfae798;
        uStack_174 = 0;
        local_108[0] = &PTR_LAB_00fae8e0;
        local_188 = 0xfae8b8;
        uStack_184 = 0;
        uStack_180 = 0;
        uStack_17c = 0;
        local_198 = lVar19;
                    /* try { // try from 00a98b45 to 00a98b4c has its CatchHandler @ 00a99442 */
        FUN_00a4edb0(local_108,&local_170);
        local_80 = 0;
        local_78 = 0xffffffff;
        local_188 = 0xfae770;
        uStack_184 = 0;
        local_108[0] = &PTR_LAB_00fae7c0;
        local_178 = 0xfae798;
        uStack_174 = 0;
                    /* try { // try from 00a98b7e to 00a98b85 has its CatchHandler @ 00a99438 */
        FUN_00a4fac0(&local_170);
        local_170 = 0xfae968;
        uStack_16c = 0;
        local_120 = (undefined1  [16])0x0;
        local_130 = (undefined1  [16])0x0;
        local_110 = 0x18;
                    /* try { // try from 00a98bbc to 00a98bfd has its CatchHandler @ 00a994cf */
        uVar12 = FUN_00427500(&local_178,"Declaring client ",0x11);
        uVar12 = FUN_00a563e0(uVar12,(undefined2)local_6c);
        uVar12 = FUN_00427500(uVar12," dead because we could not assign a packet ID. count: ",0x36);
        FUN_00a56a50(uVar12,CONCAT44(uStack_19c,local_1a0));
                    /* try { // try from 00a98bfe to 00a98c0a has its CatchHandler @ 00a99424 */
        FUN_004277d0(local_1d8,&local_170);
        local_58 = (void *)0x0;
        local_68._1_8_ = 0x6c646e6148746b50;
        local_68[0] = 0x14;
        local_68._9_2_ = 0x7265;
        local_68._12_4_ = SUB164((undefined1  [16])0x0,0xc);
        local_68[0xb] = 0;
                    /* try { // try from 00a98c59 to 00a98c6f has its CatchHandler @ 00a993ee */
        FUN_0042c200(local_1d8,4,local_68,*(undefined8 *)(param_1 + 0x58));
        if ((local_68[0] & 1) != 0) {
          operator_delete(local_58);
        }
        if ((local_1d8[0] & 1) != 0) {
          operator_delete(local_1c8);
        }
        local_188 = 0xfae770;
        uStack_184 = 0;
        local_108[0] = &PTR_LAB_00fae7c0;
        local_178 = 0xfae798;
        uStack_174 = 0;
        local_170 = 0xfae968;
        uStack_16c = 0;
        if ((local_130[0] & 1) != 0) {
          operator_delete((void *)local_120._0_8_);
        }
        FUN_00a4f8b0(&local_170);
        FUN_00a59ea0(&local_188,&PTR_PTR_00fae7d8);
        thunk_FUN_00a4e4f0(local_108);
                    /* try { // try from 00a98cf0 to 00a98cf9 has its CatchHandler @ 00a994ae */
        FUN_004679e0(local_198);
      }
      else if (&local_1b8 != local_1b0) {
        uVar14 = auVar20._0_8_ >> 0x10;
        pbVar15 = local_1b0;
        do {
                    /* try { // try from 00a98534 to 00a98561 has its CatchHandler @ 00a99648 */
          iVar8 = (int)(uVar14 & 0xffff);
          FUN_0049fce0(*(long *)(pbVar15 + 0x10),uVar14 & 0xffff);
          FUN_0049fcf0(*(long *)(pbVar15 + 0x10),lVar18);
          FUN_00a93340(param_1,*(long *)(pbVar15 + 0x10),uVar16,0,0);
          uVar14 = (ulong)(iVar8 + 1);
          lVar18 = lVar18 + (ulong)(iVar8 == 0xffff);
          pbVar15 = *(byte **)(pbVar15 + 8);
        } while (&local_1b8 != pbVar15);
      }
      if (local_1a8 == (void *)0x0) {
        return;
      }
      lVar19 = *(long *)local_1b0;
      *(undefined8 *)(lVar19 + 8) = *(undefined8 *)(CONCAT71(uStack_1b7,local_1b8) + 8);
      **(long **)(CONCAT71(uStack_1b7,local_1b8) + 8) = lVar19;
      local_1a8 = (void *)0x0;
      while (local_1b0 != &local_1b8) {
        pbVar15 = *(byte **)(local_1b0 + 8);
        operator_delete(local_1b0);
        local_1b0 = pbVar15;
      }
      return;
    }
  }
  if (((byte)uVar14 < 2) && (cVar5 = FUN_0045d940(lVar19), cVar5 == '\0')) {
    FUN_00aa11c0(param_4);
  }
  LOCK();
  piVar2 = (int *)(param_1 + 0x78 + uVar16 * 4);
  *piVar2 = *piVar2 + 1;
  UNLOCK();
  iVar8 = FUN_0049fcb0(param_4);
  iVar9 = (**(code **)(**(long **)(param_1 + 0x40) + 0x18))();
  LOCK();
  piVar2 = (int *)(param_1 + 0xc0 + uVar16 * 4);
  *piVar2 = *piVar2 + iVar9 + iVar8;
  UNLOCK();
  cVar5 = FUN_00464870(lVar19);
  if ((cVar5 == '\0') || ((char)local_18c != '\0')) {
    local_50 = (short *)(lVar19 + 0x400);
    FUN_004a55e0(&local_188);
                    /* try { // try from 00a9860e to 00a98618 has its CatchHandler @ 00a9953d */
    FUN_0049fd20(param_4,&local_188);
    FUN_004a55d0(&local_188);
    uVar10 = FUN_0045d440(lVar19);
    FUN_0049fd10(param_4,uVar10);
    uVar11 = FUN_0049fcb0(param_4);
    FUN_0049fc80(&local_188,param_4);
                    /* try { // try from 00a9864f to 00a98675 has its CatchHandler @ 00a995a7 */
    cVar5 = FUN_004a5d90(&local_188);
    uVar13 = 500;
    if (cVar5 != '\0') {
      uVar13 = 0x454;
    }
    if (uVar13 < uVar11) {
      cVar5 = FUN_0049fc60(param_4);
      FUN_004a55d0(&local_188);
      if (cVar5 != '\x01') {
        local_178 = 0xfae798;
        uStack_174 = 0;
        local_108[0] = &PTR_LAB_00fae8e0;
        local_188 = 0xfae8b8;
        uStack_184 = 0;
        uStack_180 = 0;
        uStack_17c = 0;
        local_1bc = uVar17;
        local_198 = lVar19;
                    /* try { // try from 00a986d4 to 00a986db has its CatchHandler @ 00a9942e */
        FUN_00a4edb0(local_108,&local_170);
        local_80 = 0;
        local_78 = 0xffffffff;
        local_188 = 0xfae770;
        uStack_184 = 0;
        local_108[0] = &PTR_LAB_00fae7c0;
        local_178 = 0xfae798;
        uStack_174 = 0;
                    /* try { // try from 00a9870d to 00a98714 has its CatchHandler @ 00a99429 */
        FUN_00a4fac0(&local_170);
        local_170 = 0xfae968;
        uStack_16c = 0;
        local_120 = (undefined1  [16])0x0;
        local_130 = (undefined1  [16])0x0;
        local_110 = 0x18;
                    /* try { // try from 00a9874b to 00a9878d has its CatchHandler @ 00a994b3 */
        uVar12 = FUN_00427500(&local_178,
                              "Assertion \"packet->getPacketSize() <= get_packet_mtu(packet->getPeerAddr().is_v6()) || packet->getType() == VOICE_WHISPER\" failed at ../../../../deps/teamspeak_common_lib/src/packethandler_base.cpp:"
                              ,0xc6);
        uVar12 = FUN_00a56570(uVar12,0x2dd);
        uVar12 = FUN_00427500(uVar12,"; ",2);
        FUN_00427500(uVar12,&DAT_00bebd6a,0);
                    /* try { // try from 00a9878e to 00a9879c has its CatchHandler @ 00a993e9 */
        FUN_004277d0(&local_1b8,&local_170);
        local_1c8 = (void *)0x0;
        local_1d8._1_8_ = 0x6c646e6148746b50;
        local_1d8[0] = 0x14;
        local_1d8._9_2_ = 0x7265;
        local_1d8._12_4_ = SUB164((undefined1  [16])0x0,0xc);
        local_1d8[0xb] = 0;
                    /* try { // try from 00a987d9 to 00a987e9 has its CatchHandler @ 00a993b9 */
        FUN_0042c200(&local_1b8,0,local_1d8,*(undefined8 *)(param_1 + 0x58));
        if ((local_1d8[0] & 1) != 0) {
          operator_delete(local_1c8);
        }
        if ((local_1b8 & 1) != 0) {
          operator_delete(local_1a8);
        }
        local_188 = 0xfae770;
        uStack_184 = 0;
        local_108[0] = &PTR_LAB_00fae7c0;
        local_178 = 0xfae798;
        uStack_174 = 0;
        local_170 = 0xfae968;
        uStack_16c = 0;
        if ((local_130[0] & 1) != 0) {
          operator_delete((void *)local_120._0_8_);
        }
        FUN_00a4f8b0(&local_170);
        FUN_00a59ea0(&local_188,&PTR_PTR_00fae7d8);
        thunk_FUN_00a4e4f0(local_108);
        lVar19 = local_198;
        uVar17 = local_1bc;
      }
    }
    else {
      FUN_004a55d0(&local_188);
    }
    if ((char)local_18c == '\0') {
      if (param_7 != '\0') {
        uVar11 = FUN_0045e220(lVar19,uVar16);
        if ((char)uVar11 == '\0') {
          local_178 = 0xfae798;
          uStack_174 = 0;
          local_108[0] = &PTR_LAB_00fae8e0;
          local_188 = 0xfae8b8;
          uStack_184 = 0;
          uStack_180 = 0;
          uStack_17c = 0;
          local_198 = lVar19;
                    /* try { // try from 00a98f07 to 00a98f0e has its CatchHandler @ 00a9935e */
          FUN_00a4edb0(local_108,&local_170);
          local_80 = 0;
          local_78 = 0xffffffff;
          local_188 = 0xfae770;
          uStack_184 = 0;
          local_108[0] = &PTR_LAB_00fae7c0;
          local_178 = 0xfae798;
          uStack_174 = 0;
                    /* try { // try from 00a98f41 to 00a98f48 has its CatchHandler @ 00a99359 */
          FUN_00a4fac0(&local_170);
          local_170 = 0xfae968;
          uStack_16c = 0;
          local_120 = (undefined1  [16])0x0;
          local_130 = (undefined1  [16])0x0;
          local_110 = 0x18;
                    /* try { // try from 00a98f7f to 00a98fb9 has its CatchHandler @ 00a99490 */
          uVar12 = FUN_00427500(&local_178,"Declaring client ",0x11);
          uVar7 = FUN_0049fc40(param_4);
          uVar12 = FUN_00a563e0(uVar12,uVar7);
          FUN_00427500(uVar12," dead because we could not assign a packet ID.",0x2e);
                    /* try { // try from 00a98fba to 00a98fcb has its CatchHandler @ 00a99354 */
          FUN_004277d0(&local_1b8,&local_170);
          local_1c8 = (void *)0x0;
          local_1d8._1_8_ = 0x6c646e6148746b50;
          local_1d8[0] = 0x14;
          local_1d8._9_2_ = 0x7265;
          local_1d8._12_4_ = SUB164((undefined1  [16])0x0,0xc);
          local_1d8[0xb] = 0;
                    /* try { // try from 00a99008 to 00a9901b has its CatchHandler @ 00a99324 */
          FUN_0042c200(&local_1b8,4,local_1d8,*(undefined8 *)(param_1 + 0x58));
          if ((local_1d8[0] & 1) != 0) {
            operator_delete(local_1c8);
          }
          if ((local_1b8 & 1) != 0) {
            operator_delete(local_1a8);
          }
          local_188 = 0xfae770;
          uStack_184 = 0;
          local_108[0] = &PTR_LAB_00fae7c0;
          local_178 = 0xfae798;
          uStack_174 = 0;
          local_170 = 0xfae968;
          uStack_16c = 0;
          if ((local_130[0] & 1) != 0) {
            operator_delete((void *)local_120._0_8_);
          }
          FUN_00a4f8b0(&local_170);
          FUN_00a59ea0(&local_188,&PTR_PTR_00fae7d8);
          thunk_FUN_00a4e4f0(local_108);
          lVar19 = local_198;
          if (param_4 != (long *)0x0) {
            (**(code **)(*param_4 + 8))(param_4);
          }
          FUN_004679e0(lVar19);
          return;
        }
        FUN_0049fce0(param_4,uVar11 >> 0x10);
        FUN_0049fcf0(param_4,extraout_RDX);
      }
      local_1bc = uVar17;
      uVar12 = FUN_0049fc30(param_4);
      uVar7 = FUN_0049fc20(param_4);
      cVar5 = FUN_0049fc50(param_4);
      if (cVar5 == '\0') {
        cVar5 = FUN_00460ba0(lVar19,0,uVar7,uVar16,uVar12,&local_188,&local_1b8);
        if (cVar5 == '\0') goto joined_r0x00a9928a;
        FUN_0049fd30(param_4,CONCAT44(uStack_184,local_188),CONCAT71(uStack_1b7,local_1b8),
                     *local_50 != 2);
        if ((void *)CONCAT44(uStack_184,local_188) != (void *)0x0) {
          operator_delete__((void *)CONCAT44(uStack_184,local_188));
        }
      }
      else {
        cVar5 = FUN_0049f4a0(uVar16);
        if (cVar5 != '\0') {
          local_18c = CONCAT22(local_18c._2_2_,uVar7);
          local_178 = 0xfae798;
          uStack_174 = 0;
          local_108[0] = &PTR_LAB_00fae8e0;
          local_188 = 0xfae8b8;
          uStack_184 = 0;
          uStack_180 = 0;
          uStack_17c = 0;
          local_198 = lVar19;
                    /* try { // try from 00a9894d to 00a98954 has its CatchHandler @ 00a99374 */
          FUN_00a4edb0(local_108,&local_170);
          local_80 = 0;
          local_78 = 0xffffffff;
          local_188 = 0xfae770;
          uStack_184 = 0;
          local_108[0] = &PTR_LAB_00fae7c0;
          local_178 = 0xfae798;
          uStack_174 = 0;
                    /* try { // try from 00a98986 to 00a9898d has its CatchHandler @ 00a9936f */
          FUN_00a4fac0(&local_170);
          local_170 = 0xfae968;
          uStack_16c = 0;
          local_120 = (undefined1  [16])0x0;
          local_130 = (undefined1  [16])0x0;
          local_110 = 0x18;
                    /* try { // try from 00a989c4 to 00a98a06 has its CatchHandler @ 00a994ac */
          uVar12 = FUN_00427500(&local_178,
                                "Assertion \"!isResendingPacketType(packetType)\" failed at ../../../../deps/teamspeak_common_lib/src/packethandler_base.cpp:"
                                ,0x7a);
          uVar12 = FUN_00a56570(uVar12,0x2f3);
          uVar12 = FUN_00427500(uVar12,"; ",2);
          FUN_00427500(uVar12,&DAT_00bebd6a,0);
                    /* try { // try from 00a98a07 to 00a98a15 has its CatchHandler @ 00a9936a */
          FUN_004277d0(&local_1b8,&local_170);
          local_1c8 = (void *)0x0;
          local_1d8._1_8_ = 0x6c646e6148746b50;
          local_1d8[0] = 0x14;
          local_1d8._9_2_ = 0x7265;
          local_1d8._12_4_ = SUB164((undefined1  [16])0x0,0xc);
          local_1d8[0xb] = 0;
                    /* try { // try from 00a98a52 to 00a98a62 has its CatchHandler @ 00a99368 */
          FUN_0042c200(&local_1b8,0,local_1d8,*(undefined8 *)(param_1 + 0x58));
          if ((local_1d8[0] & 1) != 0) {
            operator_delete(local_1c8);
          }
          if ((local_1b8 & 1) != 0) {
            operator_delete(local_1a8);
          }
          local_188 = 0xfae770;
          uStack_184 = 0;
          local_108[0] = &PTR_LAB_00fae7c0;
          local_178 = 0xfae798;
          uStack_174 = 0;
          local_170 = 0xfae968;
          uStack_16c = 0;
          if ((local_130[0] & 1) != 0) {
            operator_delete((void *)local_120._0_8_);
          }
          FUN_00a4f8b0(&local_170);
          FUN_00a59ea0(&local_188,&PTR_PTR_00fae7d8);
          thunk_FUN_00a4e4f0(local_108);
          lVar19 = local_198;
          uVar7 = (undefined2)local_18c;
        }
        uVar12 = FUN_00461720(lVar19);
        FUN_004a0860(param_4,uVar12);
      }
      cVar5 = (char)local_1bc;
      if (cVar5 == '\x04') {
        FUN_00460a40(lVar19,uVar7);
      }
      cVar6 = FUN_0049f4a0(uVar16);
      if (cVar6 != '\0') {
        cVar6 = FUN_00465410(lVar19,param_4);
        if (cVar6 != '\0') {
          if ((cVar5 == '\x02') && (cVar5 = FUN_00a9fc90(param_4), cVar5 != '\0')) {
            FUN_00464760(lVar19);
          }
          local_40 = *local_48;
          plVar4 = (long *)local_48[1];
          if (plVar4 != (long *)0x0) {
            LOCK();
            *(int *)(plVar4 + 1) = (int)plVar4[1] + 1;
            UNLOCK();
          }
                    /* try { // try from 00a98e2c to 00a98e3d has its CatchHandler @ 00a992e1 */
          local_38 = plVar4;
          FUN_00a996a0(param_1,&local_40);
          if (plVar4 == (long *)0x0) {
            return;
          }
          LOCK();
          plVar1 = plVar4 + 1;
          *(int *)plVar1 = (int)*plVar1 + -1;
          UNLOCK();
          if ((int)*plVar1 != 0) {
            return;
          }
                    /* try { // try from 00a98e4d to 00a98e62 has its CatchHandler @ 00a99295 */
          (**(code **)(*plVar4 + 0x10))(plVar4);
          LOCK();
          piVar2 = (int *)((long)plVar4 + 0xc);
          *piVar2 = *piVar2 + -1;
          UNLOCK();
          if (*piVar2 == 0) {
            (**(code **)(*plVar4 + 0x18))(plVar4);
            return;
          }
          return;
        }
        local_178 = 0xfae798;
        uStack_174 = 0;
        local_108[0] = &PTR_LAB_00fae8e0;
        local_188 = 0xfae8b8;
        uStack_184 = 0;
        uStack_180 = 0;
        uStack_17c = 0;
        local_198 = lVar19;
                    /* try { // try from 00a990fa to 00a99101 has its CatchHandler @ 00a992d7 */
        FUN_00a4edb0(local_108,&local_170);
        local_80 = 0;
        local_78 = 0xffffffff;
        local_188 = 0xfae770;
        uStack_184 = 0;
        local_108[0] = &PTR_LAB_00fae7c0;
        local_178 = 0xfae798;
        uStack_174 = 0;
                    /* try { // try from 00a99133 to 00a9913a has its CatchHandler @ 00a992d2 */
        FUN_00a4fac0(&local_170);
        local_170 = 0xfae968;
        uStack_16c = 0;
        local_120 = (undefined1  [16])0x0;
        local_130 = (undefined1  [16])0x0;
        local_110 = 0x18;
                    /* try { // try from 00a99171 to 00a991a5 has its CatchHandler @ 00a9937e */
        uVar12 = FUN_00427500(&local_178,"Declaring client ",0x11);
        uVar12 = FUN_00a563e0(uVar12,(undefined2)local_6c);
        FUN_00427500(uVar12," dead because send queue was full",0x21);
                    /* try { // try from 00a991a6 to 00a991b2 has its CatchHandler @ 00a992cd */
        FUN_004277d0(&local_1b8,&local_170);
        local_1c8 = (void *)0x0;
        local_1d8._1_8_ = 0x6c646e6148746b50;
        local_1d8[0] = 0x14;
        local_1d8._9_2_ = 0x7265;
        local_1d8._12_4_ = SUB164((undefined1  [16])0x0,0xc);
        local_1d8[0xb] = 0;
                    /* try { // try from 00a991ef to 00a99202 has its CatchHandler @ 00a9929d */
        FUN_0042c200(&local_1b8,4,local_1d8,*(undefined8 *)(param_1 + 0x58));
        if ((local_1d8[0] & 1) != 0) {
          operator_delete(local_1c8);
        }
        if ((local_1b8 & 1) != 0) {
          operator_delete(local_1a8);
        }
        local_188 = 0xfae770;
        uStack_184 = 0;
        local_108[0] = &PTR_LAB_00fae7c0;
        local_178 = 0xfae798;
        uStack_174 = 0;
        local_170 = 0xfae968;
        uStack_16c = 0;
        if ((local_130[0] & 1) != 0) {
          operator_delete((void *)local_120._0_8_);
        }
        FUN_00a4f8b0(&local_170);
        FUN_00a59ea0(&local_188,&PTR_PTR_00fae7d8);
        thunk_FUN_00a4e4f0(local_108);
        FUN_004679e0(local_198);
        goto joined_r0x00a9928a;
      }
    }
    iVar8 = FUN_0049fcb0(param_4);
    iVar9 = (**(code **)(**(long **)(param_1 + 0x40) + 0x18))();
    FUN_0045d990(lVar19,uVar16,iVar9 + iVar8,1);
    (**(code **)(**(long **)(param_1 + 0x40) + 0x10))
              (*(long **)(param_1 + 0x40),param_4,lVar19 + 0x3f0,local_50);
  }
  else {
joined_r0x00a9928a:
    if (param_4 != (long *)0x0) {
      (**(code **)(*param_4 + 8))(param_4);
    }
  }
  return;
}

